/**
 * WebContentsView 嵌入网页管理模块
 *
 * 基于 Electron 30+ 引入的 WebContentsView，在主窗口内嵌入外部网页。
 * 安全策略：
 *   1. URL 白名单 —— 仅允许加载指定域名，拦截非白名单导航
 *   2. 新窗口 —— 始终用系统浏览器打开，不在应用内打开
 *   3. 沙箱隔离 —— 独立 session partition + sandbox + contextIsolation
 *   4. 禁用 Node —— nodeIntegration: false
 *
 * 同时支持多 webview（每个动态企业 SSO 页签对应一个 view），通过 tabId 区分。
 * 仅 active tab 的 webview 可见，其他 webview 全部隐藏。
 */
const { WebContentsView, shell } = require('electron');

// URL 白名单 —— 仅允许加载这些域名（protocol//host）
// 按需扩展；SSRF 防护：白名单机制天然阻止内网地址（9.*, 10.*, 11.* 等）
const ALLOWED_ORIGINS = [
  'https://meeting.tencent.com',
  'https://www.tencent.com',
  'https://cloud.tencent.com',
];

/**
 * 动态白名单：包含用户在设置中配置的服务端 URL
 */
function getDynamicOrigins() {
  const origins = [...ALLOWED_ORIGINS];
  try {
    const appSettings = require('../utils/app-settings');
    const baseUrl = appSettings.getBaseUrl();
    const parsed = new URL(baseUrl);
    origins.push(`${parsed.protocol}//${parsed.host}`);
  } catch {}
  return [...new Set(origins)]; // 去重
}

// 独立 session 分区，避免与主窗口共享 cookie / UA
const WEBVIEW_PARTITION = 'webview-session';

// 默认自定义 UA（可在 createWebview 时通过 options 覆盖）
// 根据当前运行平台与 Electron 内置 Chromium 版本动态生成
function getDefaultUA() {
  let platformStr;
  switch (process.platform) {
    case 'win32':
      platformStr = 'Windows NT 10.0; Win64; x64';
      break;
    case 'darwin':
      platformStr =
        process.arch === 'arm64'
          ? 'Macintosh; ARM Mac OS X'
          : 'Macintosh; Intel Mac OS X 10_15_7';
      break;
    case 'linux':
    default:
      platformStr = 'X11; Linux x86_64';
      break;
  }
  const chromeVer = process.versions.chrome || '126.0.0.0';
  return `WeMeetSDK/1.0 (${platformStr}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
}

// 多 webview 存储：tabId -> { view, url, title, onClosed }
// 使用 Map 保证插入顺序可控
const webviews = new Map();
// 共享的 bounds，活动 webview 改变或窗口 resize 时刷新
let sharedBounds = { x: 0, y: 0, width: 1, height: 1 };
let parentWindow = null;
let activeTabId = null;
let isDevWebviewPresent = false; // 兼容旧的「应用」开发页签

function init(win) {
  parentWindow = win;
}

/**
 * 校验 URL 是否在白名单内
 * @param {string} url
 * @returns {{ ok: boolean, message?: string, origin?: string }}
 */
function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, message: 'URL 不能为空' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: 'URL 格式不合法' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: '仅支持 http/https 协议' };
  }
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (!getDynamicOrigins().includes(origin)) {
    return { ok: false, message: `不允许加载此域名: ${parsed.host}`, origin };
  }
  return { ok: true, origin };
}

/**
 * 实际创建一个 WebContentsView 并挂到主窗口
 */
function _attachView(tabId, url, options) {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: WEBVIEW_PARTITION,
    },
  });

  const wc = view.webContents;
  wc.setUserAgent(options.userAgent || getDefaultUA());

  // 安全：拦截导航，仅允许白名单内跳转
  wc.on('will-navigate', (event, navUrl) => {
    const navCheck = validateUrl(navUrl);
    if (!navCheck.ok) {
      event.preventDefault();
      console.warn('[Webview] 拦截了非白名单导航:', navUrl, '-', navCheck.message);
    }
  });

  // 安全：新窗口用系统浏览器打开，不在应用内打开
  wc.setWindowOpenHandler(({ url: openUrl }) => {
    const openCheck = validateUrl(openUrl);
    if (openCheck.ok) {
      shell.openExternal(openUrl);
    } else {
      console.warn('[Webview] 拦截了非白名单新窗口:', openUrl);
    }
    return { action: 'deny' };
  });

  // 监听 title 更新，回调给渲染进程（用于动态页签显示标题）
  wc.on('page-title-updated', (_event, title) => {
    const item = webviews.get(tabId);
    if (item) {
      item.title = title;
      _emitTitleUpdate(tabId, title);
    }
  });

  // 诊断：跟踪跳转链（含 302 重定向）
  // 捕获初始 URL / 每次重定向 / 最终落地页，便于排查 SSO 跳转登录页等问题
  _wireNavigationDiagnostics(wc, tabId);

  parentWindow.contentView.addChildView(view);
  view.setBounds(sharedBounds);
  view.setVisible(false);
  wc.loadURL(url);

  return view;
}

function _emitTitleUpdate(tabId, title) {
  if (!parentWindow || parentWindow.isDestroyed()) return;
  parentWindow.webContents.send('webview-title-updated', { tabId, title });
}

function _emitNavigation(tabId, payload) {
  if (!parentWindow || parentWindow.isDestroyed()) return;
  parentWindow.webContents.send('webview-navigation', { tabId, ...payload });
}

/**
 * 注册跳转链诊断事件：把每一次导航（首跳 / 重定向 / 失败）都通知渲染进程。
 * 主要用于排查 SSO 跳转登录页（302 → /user-center/login?reason=xxx）等问题。
 */
function _wireNavigationDiagnostics(wc, tabId) {
  // 记录每个 tab 的跳转链：[ { from, to, statusCode?, isMainFrame } ]
  // 仅保留最近 N 条，避免内存膨胀
  const chain = [];
  const pushChain = (entry) => {
    chain.push(entry);
    if (chain.length > 20) chain.shift();
  };

  // 暴露给"获取 webview 详情"接口，便于调试时手动调用
  wc.__ssoNavChain = chain;

  wc.on('did-start-navigation', (_event, navUrl, _isInPlace, _isMainFrame, _frameProcessId, _frameRoutingId) => {
    pushChain({ from: wc.getURL(), to: navUrl, phase: 'start' });
    _emitNavigation(tabId, {
      type: 'start',
      url: navUrl,
      chain: chain.slice(),
    });
  });

  // 重定向通知：server 302 时触发，包含 statusCode（>=300 && <400）
  wc.on('did-redirect-navigation', (_event, navUrl, _httpResponseCode, _httpMethod, _referrer, _responseHeaders) => {
    pushChain({ from: wc.getURL(), to: navUrl, phase: 'redirect' });
    console.log('[Webview][SSO]', tabId, '重定向 ->', navUrl);
    _emitNavigation(tabId, {
      type: 'redirect',
      url: navUrl,
      chain: chain.slice(),
    });
  });

  // 真正完成一次主框架导航（含所有重定向）
  wc.on('did-navigate', (_event, navUrl) => {
    pushChain({ from: null, to: navUrl, phase: 'navigate' });
    console.log('[Webview][SSO]', tabId, '落地 ->', navUrl);
    _emitNavigation(tabId, {
      type: 'navigate',
      url: navUrl,
      chain: chain.slice(),
    });
  });

  // in-page 跳转（hash 变化等）
  wc.on('did-navigate-in-page', (_event, navUrl) => {
    pushChain({ from: null, to: navUrl, phase: 'navigate-in-page' });
    _emitNavigation(tabId, {
      type: 'navigate-in-page',
      url: navUrl,
      chain: chain.slice(),
    });
  });

  // 加载失败（DNS / 证书 / 拦截等）
  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return; // 子资源失败不告警
    pushChain({ from: wc.getURL(), to: validatedURL, phase: 'fail', errorCode, errorDescription });
    console.warn('[Webview][SSO]', tabId, '加载失败', errorCode, errorDescription, validatedURL);
    _emitNavigation(tabId, {
      type: 'fail',
      url: validatedURL,
      errorCode,
      errorDescription,
      chain: chain.slice(),
    });
  });
}

/**
 * 判断 view 是否仍然有效（WebContentsView 没有 isDestroyed，需查其内部 webContents）
 * @param {{view: Electron.WebContentsView}|undefined} item
 * @returns {boolean}
 */
function isViewValid(item) {
  return !!(item && item.view && item.view.webContents && !item.view.webContents.isDestroyed());
}

/**
 * 创建嵌入网页视图
 * @param {string} tabId - 页签唯一 ID
 * @param {string} url - 要加载的 URL（必须在白名单内）
 * @param {{x:number,y:number,width:number,height:number}} bounds - 在主窗口中的位置和大小
 * @param {{userAgent?:string, replace?:boolean, activate?:boolean}} [options] - 可选配置
 * @returns {{success:boolean, message?:string, tabId?:string}}
 */
function createWebview(tabId, url, bounds, options = {}) {
  if (!parentWindow || parentWindow.isDestroyed()) {
    return { success: false, message: '主窗口不存在' };
  }

  if (!tabId || typeof tabId !== 'string') {
    return { success: false, message: 'tabId 不能为空' };
  }

  const check = validateUrl(url);
  if (!check.ok) {
    return { success: false, message: check.message };
  }

  if (
    !bounds ||
    typeof bounds.x !== 'number' ||
    typeof bounds.y !== 'number' ||
    typeof bounds.width !== 'number' ||
    typeof bounds.height !== 'number' ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return { success: false, message: 'bounds 参数不合法' };
  }

  // 同步最新 bounds，保证创建时使用最新尺寸
  sharedBounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };

  // 已存在：替换 URL（reload）
  if (webviews.has(tabId)) {
    const item = webviews.get(tabId);
    item.url = url;
    if (options.userAgent) {
      item.view.webContents.setUserAgent(options.userAgent);
    }
    item.view.webContents.loadURL(url);
    if (options.activate !== false) {
      setActive(tabId);
    }
    return { success: true, tabId };
  }

  // 「应用」开发页签复用同一个 view（向后兼容）
  if (tabId === 'webview') {
    if (isDevWebviewPresent) {
      // 已有：直接 reload
      const item = webviews.get('webview');
      item.url = url;
      item.view.webContents.loadURL(url);
      setActive('webview');
      return { success: true, tabId: 'webview' };
    }
    isDevWebviewPresent = true;
  }

  const view = _attachView(tabId, url, options);
  webviews.set(tabId, { view, url, title: '' });

  if (options.activate !== false) {
    setActive(tabId);
  }

  return { success: true, tabId };
}

/**
 * 调整所有嵌入视图位置/大小（窗口 resize / tab 切换时调用）
 * @param {{x:number,y:number,width:number,height:number}} bounds
 */
function resizeWebview(bounds) {
  if (
    !bounds ||
    typeof bounds.x !== 'number' ||
    typeof bounds.y !== 'number' ||
    typeof bounds.width !== 'number' ||
    typeof bounds.height !== 'number' ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return;
  }
  sharedBounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
  for (const item of webviews.values()) {
    if (isViewValid(item)) {
      item.view.setBounds(sharedBounds);
    }
  }
}

/** 关闭并销毁指定 tabId 的嵌入视图 */
function closeWebviewById(tabId) {
  const item = webviews.get(tabId);
  if (!item) return { success: true };
  try {
    if (parentWindow && !parentWindow.isDestroyed()) {
      parentWindow.contentView.removeChildView(item.view);
    }
    const wc = item.view.webContents;
    if (wc && !wc.isDestroyed()) {
      wc.destroy();
    }
  } catch (err) {
    console.warn('[Webview] 销毁视图异常:', err.message);
  } finally {
    webviews.delete(tabId);
    if (tabId === 'webview') isDevWebviewPresent = false;
    if (activeTabId === tabId) {
      activeTabId = null;
    }
  }
  return { success: true };
}

/** 关闭所有嵌入视图 */
function closeAllWebviews() {
  for (const tabId of Array.from(webviews.keys())) {
    closeWebviewById(tabId);
  }
  activeTabId = null;
  isDevWebviewPresent = false;
  return { success: true };
}

/** 隐藏嵌入视图（切到其他 tab 时调用，不销毁） */
function hideWebview(tabId) {
  const target = tabId ? webviews.get(tabId) : null;
  if (isViewValid(target)) {
    target.view.setVisible(false);
  } else {
    // 未传 tabId：隐藏所有
    for (const item of webviews.values()) {
      if (isViewValid(item)) {
        item.view.setVisible(false);
      }
    }
  }
  return { success: true };
}

/** 显示指定 tabId 的嵌入视图，并隐藏其他 */
function showWebview(tabId) {
  for (const [id, item] of webviews.entries()) {
    if (isViewValid(item)) {
      item.view.setVisible(id === tabId);
    }
  }
  if (webviews.has(tabId)) {
    activeTabId = tabId;
  }
  return { success: true };
}

/** 设置活动 tab（隐藏其他、显示当前） */
function setActive(tabId) {
  if (!webviews.has(tabId)) return { success: false, message: 'tab 不存在' };
  // 强制刷新 bounds，避免使用 0 尺寸
  for (const [, item] of webviews.entries()) {
    if (isViewValid(item)) {
      item.view.setBounds(sharedBounds);
      item.view.setVisible(false);
    }
  }
  const current = webviews.get(tabId);
  if (isViewValid(current)) {
    current.view.setBounds(sharedBounds);
    current.view.setVisible(true);
  }
  activeTabId = tabId;
  return { success: true };
}

/** 获取指定 webview 信息 */
function getWebviewInfo(tabId) {
  const item = webviews.get(tabId);
  if (!isViewValid(item)) {
    return { success: false, message: '无活跃的 webview' };
  }
  const wc = item.view.webContents;
  return {
    success: true,
    data: {
      tabId,
      url: wc.getURL(),
      title: wc.getTitle(),
      userAgent: wc.getUserAgent(),
    },
  };
}

/** 列出所有 webview（仅元信息，不返回 webContents） */
function listWebviews() {
  const result = [];
  for (const [tabId, item] of webviews.entries()) {
    if (isViewValid(item)) {
      const wc = item.view.webContents;
      result.push({
        tabId,
        url: wc.getURL(),
        title: wc.getTitle(),
        active: tabId === activeTabId,
      });
    }
  }
  return { success: true, data: result, activeTabId };
}

/** 是否存在指定 webview */
function hasWebview(tabId) {
  if (tabId) return webviews.has(tabId);
  return webviews.size > 0;
}

/** 关闭并销毁嵌入视图（兼容旧 API：关闭当前活动 tab） */
function closeWebview() {
  if (activeTabId) {
    return closeWebviewById(activeTabId);
  }
  // 没有 active：兜底关闭全部
  return closeAllWebviews();
}

/** 隐藏嵌入视图（兼容旧 API：隐藏所有） */
function hideWebviewAll() {
  for (const item of webviews.values()) {
    if (isViewValid(item)) {
      item.view.setVisible(false);
    }
  }
  return { success: true };
}

/** 显示嵌入视图（兼容旧 API：显示当前 active） */
function showActiveWebview() {
  if (activeTabId && webviews.has(activeTabId)) {
    return showWebview(activeTabId);
  }
  return { success: false, message: '无 active webview' };
}

/** 后退 */
function goBack(tabId) {
  const target = tabId ? webviews.get(tabId) : webviews.get(activeTabId);
  if (isViewValid(target) && target.view.webContents.navigationHistory.canGoBack()) {
    target.view.webContents.navigationHistory.goBack();
  }
  return { success: true };
}

/** 前进 */
function goForward(tabId) {
  const target = tabId ? webviews.get(tabId) : webviews.get(activeTabId);
  if (isViewValid(target) && target.view.webContents.navigationHistory.canGoForward()) {
    target.view.webContents.navigationHistory.goForward();
  }
  return { success: true };
}

/** 刷新当前页 */
function reload(tabId) {
  const target = tabId ? webviews.get(tabId) : webviews.get(activeTabId);
  if (isViewValid(target)) {
    target.view.webContents.reload();
  }
  return { success: true };
}

module.exports = {
  init,
  createWebview,
  resizeWebview,
  closeWebview,
  closeWebviewById,
  closeAllWebviews,
  hideWebview,
  hideWebviewAll,
  showWebview,
  showActiveWebview,
  setActive,
  getWebviewInfo,
  listWebviews,
  hasWebview,
  goBack,
  goForward,
  reload,
  ALLOWED_ORIGINS,
  WEBVIEW_PARTITION,
};
