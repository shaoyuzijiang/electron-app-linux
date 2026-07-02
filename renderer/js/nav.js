// ========== 全局导航与页签切换 ==========
// 负责侧边栏页签切换、各页面区域显隐、用户头像、默认页签初始化
// 本文件必须在各业务模块（meeting.js / im.js / contacts.js 等）之前加载
//
// 支持动态企业页签：通过 NavModule.registerDynamicTab() / unregisterDynamicTab() 管理。
// 动态页签会插入到「会议」页签下方，可被单独关闭（带 × 按钮）。

// 各页面区域元素（全局共享，供 meeting.js 等模块直接引用）
const sdkLoadingEl = document.getElementById('sdkLoading');
const leftPanelEl = document.getElementById('leftPanel');
const rightContentEl = document.getElementById('rightContent');
const contactsPageEl = document.getElementById('contactsPage');
const imPageEl = document.getElementById('imPage');
const calendarPageEl = document.getElementById('calendarPage');
const webviewPageEl = document.getElementById('webviewPage');

// 会议内容区域（leftPanel + rightContent）
const meetingContentEls = () => [leftPanelEl, rightContentEl];

// 当前激活的页签（内置 im/calendar/contacts/meeting/webview + 动态 enterprise-*）
let currentTab = 'im';

// 内置导航项（DOM）
const navItems = document.querySelectorAll('.nav-item[data-tab]');

// 「会议」页签 DOM 引用（用于把动态页签插入到它后面）
const meetingNavItem = document.querySelector('.nav-item[data-tab="meeting"]');
// 侧边栏 nav 容器
const sideNavEl = document.querySelector('.side-nav');

// 动态页签表：tabId -> { el, tabType, onActivate, onClose, audience?, target?, title }
const dynamicTabs = new Map();

/**
 * 切换激活态（视觉 + 派发事件）
 * @param {string} tab - 目标 tab key
 */
function switchTab(tab) {
  if (tab === currentTab) return;
  const prevTab = currentTab;
  currentTab = tab;

  // 更新内置导航的 active
  navItems.forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-tab') === tab);
  });

  // 更新动态页签的 active
  dynamicTabs.forEach((item, tabId) => {
    if (item.el) {
      item.el.classList.toggle('active', tabId === tab);
    }
  });

  // 隐藏所有页面
  meetingContentEls().forEach((el) => { el.style.display = 'none'; });
  sdkLoadingEl.style.display = 'none';
  contactsPageEl.style.display = 'none';
  if (imPageEl) imPageEl.style.display = 'none';
  if (calendarPageEl) calendarPageEl.style.display = 'none';
  if (webviewPageEl) webviewPageEl.style.display = 'none';

  if (tab === 'meeting') {
    meetingContentEls().forEach((el) => { el.style.display = ''; });
  } else if (tab === 'contacts') {
    contactsPageEl.style.display = '';
    initContacts();
  } else if (tab === 'im') {
    if (imPageEl) imPageEl.style.display = '';
    if (window.IMModule) window.IMModule.init();
  } else if (tab === 'calendar') {
    if (calendarPageEl) calendarPageEl.style.display = '';
    if (window.CalendarModule) window.CalendarModule.init();
  } else if (tab === 'webview') {
    if (webviewPageEl) {
      webviewPageEl.style.display = '';
      webviewPageEl.dataset.activeTab = 'webview';
    }
  } else if (tab.startsWith('enterprise-')) {
    // 动态企业页签：复用 webviewPage 容器，但记录当前 active tabId
    if (webviewPageEl) {
      webviewPageEl.style.display = '';
      webviewPageEl.dataset.activeTab = tab;
    }
    const dyn = dynamicTabs.get(tab);
    if (dyn && typeof dyn.onActivate === 'function') {
      try { dyn.onActivate(); } catch (e) { console.error('动态页签 onActivate 失败:', e); }
    }
  }

  // 派发 tab 切换事件，供 webview 等模块监听以同步视图状态
  document.dispatchEvent(new CustomEvent('tab-switched', {
    detail: { tab, prevTab },
  }));
}

// 内置导航项点击
navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const tab = item.getAttribute('data-tab');
    switchTab(tab);
  });
});

/**
 * 在「会议」页签之后插入一个动态页签（DOM 节点 + 注册到 dynamicTabs）
 * @param {object} cfg
 * @param {string} cfg.tabId        - 唯一 ID（建议 'enterprise-' 前缀）
 * @param {string} cfg.title        - 显示标题
 * @param {string} [cfg.iconSvg]    - 24x24 SVG path d 字符串
 * @param {string} [cfg.color]      - icon 颜色
 * @param {boolean} [cfg.closable=true] - 是否显示关闭按钮
 * @param {Function} [cfg.onActivate] - 激活时回调
 * @param {Function} [cfg.onClose]    - 关闭时回调（可选；不传则默认仅注销）
 * @returns {HTMLElement|null}
 */
function registerDynamicTab(cfg) {
  if (!cfg || !cfg.tabId) return null;
  if (dynamicTabs.has(cfg.tabId)) {
    // 已存在：仅更新标题
    const exist = dynamicTabs.get(cfg.tabId);
    if (cfg.title && exist.titleEl) {
      exist.titleEl.textContent = cfg.title;
      exist.title = cfg.title;
    }
    return exist.el;
  }

  const el = document.createElement('div');
  el.className = 'nav-item dynamic-nav-item';
  el.setAttribute('data-tab', cfg.tabId);
  el.setAttribute('title', cfg.title || '');

  // icon
  if (cfg.iconSvg) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', cfg.iconSvg);
    if (cfg.color) path.setAttribute('fill', cfg.color);
    svg.appendChild(path);
    el.appendChild(svg);
  }

  // 标题
  const titleEl = document.createElement('span');
  titleEl.className = 'dynamic-nav-title';
  titleEl.textContent = cfg.title || '';
  el.appendChild(titleEl);

  // 关闭按钮
  if (cfg.closable !== false) {
    const closeBtn = document.createElement('span');
    closeBtn.className = 'dynamic-nav-close';
    closeBtn.setAttribute('title', '关闭');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cfg.onClose) {
        try { cfg.onClose(); } catch (err) { console.error('onClose 失败:', err); }
      }
      unregisterDynamicTab(cfg.tabId);
    });
    el.appendChild(closeBtn);
  }

  // loading spinner（初始即创建，方便后续直接 add/remove class 切换状态）
  const spinnerEl = document.createElement('span');
  spinnerEl.className = 'dynamic-nav-spinner';
  el.appendChild(spinnerEl);

  // 激活
  el.addEventListener('click', () => {
    switchTab(cfg.tabId);
  });

  // 插入到「会议」之后
  if (meetingNavItem && meetingNavItem.parentNode) {
    if (meetingNavItem.nextSibling) {
      meetingNavItem.parentNode.insertBefore(el, meetingNavItem.nextSibling);
    } else {
      meetingNavItem.parentNode.appendChild(el);
    }
  } else if (sideNavEl) {
    sideNavEl.appendChild(el);
  }

  dynamicTabs.set(cfg.tabId, {
    el,
    titleEl,
    spinnerEl,
    title: cfg.title || '',
    onActivate: cfg.onActivate,
    onClose: cfg.onClose,
    audience: cfg.audience,
    target: cfg.target,
  });

  // 初始 loading 状态
  if (cfg.loading) el.classList.add('loading');

  return el;
}

/**
 * 注销动态页签（从 DOM 移除 + 从 dynamicTabs 删除）
 * 如当前激活的 tab 被注销，自动切到 meeting
 */
function unregisterDynamicTab(tabId) {
  const item = dynamicTabs.get(tabId);
  if (!item) return;
  if (item.el && item.el.parentNode) {
    item.el.parentNode.removeChild(item.el);
  }
  dynamicTabs.delete(tabId);
  if (currentTab === tabId) {
    switchTab('meeting');
  }
  // 通知 webview 模块销毁对应的 view
  if (window.electronAPI && window.electronAPI.webviewClose) {
    window.electronAPI.webviewClose(tabId);
  }
}

/**
 * 获取动态页签信息
 */
function getDynamicTab(tabId) {
  return dynamicTabs.get(tabId) || null;
}

/** 列出所有动态页签 */
function listDynamicTabs() {
  return Array.from(dynamicTabs.entries()).map(([tabId, item]) => ({
    tabId,
    title: item.title,
    audience: item.audience,
    target: item.target,
  }));
}

/** 暴露给其他模块查询当前页签 */
window.NavModule = {
  getCurrentTab: () => currentTab,
  switchTab,
  registerDynamicTab,
  unregisterDynamicTab,
  getDynamicTab,
  listDynamicTabs,
};

// ========== 初始化 ==========

// 非调试模式（正式包）隐藏 webview 页签
if (!window.electronAPI || !window.electronAPI.isDev) {
  document.querySelectorAll('.nav-item[data-tab="webview"]').forEach((item) => {
    item.remove();
  });
}

// 默认显示 IM 页签
meetingContentEls().forEach((el) => { el.style.display = 'none'; });
sdkLoadingEl.style.display = 'none';
contactsPageEl.style.display = 'none';
if (imPageEl) imPageEl.style.display = '';
if (calendarPageEl) calendarPageEl.style.display = '';
if (window.IMModule) window.IMModule.init();

// 用户头像 + 头像菜单的初始化由 enterprise-sso.js 自行处理（脚本在 nav.js 之后加载）
