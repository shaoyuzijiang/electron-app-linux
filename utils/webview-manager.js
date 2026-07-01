/**
 * WebContentsView 嵌入网页管理模块
 *
 * 基于 Electron 30+ 引入的 WebContentsView，在主窗口内嵌入外部网页。
 * 安全策略：
 *   1. URL 白名单 —— 仅允许加载指定域名，拦截非白名单导航
 *   2. 新窗口 —— 始终用系统浏览器打开，不在应用内打开
 *   3. 沙箱隔离 —— 独立 session partition + sandbox + contextIsolation
 *   4. 禁用 Node —— nodeIntegration: false
 */
const { WebContentsView, shell } = require('electron');

// URL 白名单 —— 仅允许加载这些域名（protocol//host）
// 按需扩展；SSRF 防护：白名单机制天然阻止内网地址（9.*, 10.*, 11.* 等）
const ALLOWED_ORIGINS = [
  'https://meeting.tencent.com',
  'https://www.tencent.com',
  'https://cloud.tencent.com',
];

// 独立 session 分区，避免与主窗口共享 cookie / UA
const WEBVIEW_PARTITION = 'webview-session';

// 默认自定义 UA（可在 createWebview 时通过 options 覆盖）
const DEFAULT_UA =
  'WeMeetElectronDemo/1.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let webviewView = null;
let parentWindow = null;

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
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return { ok: false, message: `不允许加载此域名: ${parsed.host}`, origin };
  }
  return { ok: true, origin };
}

/**
 * 创建嵌入网页视图
 * @param {string} url - 要加载的 URL（必须在白名单内）
 * @param {{x:number,y:number,width:number,height:number}} bounds - 在主窗口中的位置和大小
 * @param {{userAgent?:string}} [options] - 可选配置
 * @returns {{success:boolean, message?:string}}
 */
function createWebview(url, bounds, options = {}) {
  if (!parentWindow || parentWindow.isDestroyed()) {
    return { success: false, message: '主窗口不存在' };
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

  // 如已有视图，先销毁，保证同时只有一个嵌入视图
  closeWebview();

  webviewView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: WEBVIEW_PARTITION,
    },
  });

  const wc = webviewView.webContents;

  // 设置自定义 UA（独立 partition，不影响主窗口）
  wc.setUserAgent(options.userAgent || DEFAULT_UA);

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

  parentWindow.contentView.addChildView(webviewView);
  webviewView.setBounds(bounds);
  wc.loadURL(url);

  return { success: true };
}

/**
 * 调整嵌入视图位置/大小（窗口 resize / tab 切换时调用）
 * @param {{x:number,y:number,width:number,height:number}} bounds
 */
function resizeWebview(bounds) {
  if (webviewView && !webviewView.isDestroyed()) {
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
    webviewView.setBounds(bounds);
  }
}

/** 关闭并销毁嵌入视图 */
function closeWebview() {
  if (webviewView) {
    try {
      if (parentWindow && !parentWindow.isDestroyed()) {
        parentWindow.contentView.removeChildView(webviewView);
      }
      const wc = webviewView.webContents;
      if (wc && !wc.isDestroyed()) {
        wc.destroy();
      }
    } catch (err) {
      console.warn('[Webview] 销毁视图异常:', err.message);
    } finally {
      webviewView = null;
    }
  }
  return { success: true };
}

/** 隐藏嵌入视图（切到其他 tab 时调用，不销毁） */
function hideWebview() {
  if (webviewView && !webviewView.isDestroyed()) {
    webviewView.setVisible(false);
  }
  return { success: true };
}

/** 显示嵌入视图（切回 webview tab 时调用） */
function showWebview() {
  if (webviewView && !webviewView.isDestroyed()) {
    webviewView.setVisible(true);
  }
  return { success: true };
}

/** 获取当前 webview 信息 */
function getWebviewInfo() {
  if (!webviewView || webviewView.isDestroyed()) {
    return { success: false, message: '无活跃的 webview' };
  }
  const wc = webviewView.webContents;
  return {
    success: true,
    data: {
      url: wc.getURL(),
      title: wc.getTitle(),
      userAgent: wc.getUserAgent(),
    },
  };
}

/** 是否存在活跃的 webview */
function hasWebview() {
  return !!(webviewView && !webviewView.isDestroyed());
}

/** 后退 */
function goBack() {
  if (hasWebview() && webviewView.webContents.navigationHistory.canGoBack()) {
    webviewView.webContents.navigationHistory.goBack();
  }
  return { success: true };
}

/** 前进 */
function goForward() {
  if (hasWebview() && webviewView.webContents.navigationHistory.canGoForward()) {
    webviewView.webContents.navigationHistory.goForward();
  }
  return { success: true };
}

/** 刷新当前页 */
function reload() {
  if (hasWebview()) {
    webviewView.webContents.reload();
  }
  return { success: true };
}

module.exports = {
  init,
  createWebview,
  resizeWebview,
  closeWebview,
  hideWebview,
  showWebview,
  getWebviewInfo,
  hasWebview,
  goBack,
  goForward,
  reload,
};
