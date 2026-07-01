// ========== 全局导航与页签切换 ==========
// 负责侧边栏页签切换、各页面区域显隐、用户头像、默认页签初始化
// 本文件必须在各业务模块（meeting.js / im.js / contacts.js 等）之前加载

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

// 当前激活的页签
let currentTab = 'im';

// 导航项
const navItems = document.querySelectorAll('.nav-item[data-tab]');

// 用户头像信息（头像在导航栏侧边栏，属全局导航）
async function loadProfile() {
  try {
    const result = await window.electronAPI.getProfile();
    if (result.success) {
      const { username } = result.profile;
      document.getElementById('userAvatarNav').textContent = username.charAt(0).toUpperCase();
    }
  } catch (err) {
    console.error('获取用户信息失败:', err);
  }
}

// 页签切换
function switchTab(tab) {
  if (tab === currentTab) return;
  const prevTab = currentTab;
  currentTab = tab;

  navItems.forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-tab') === tab);
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
    if (webviewPageEl) webviewPageEl.style.display = '';
  }

  // 派发 tab 切换事件，供 webview 等模块监听以同步视图状态
  document.dispatchEvent(new CustomEvent('tab-switched', {
    detail: { tab, prevTab },
  }));
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const tab = item.getAttribute('data-tab');
    switchTab(tab);
  });
});

// 暴露给其他模块查询当前页签
window.NavModule = { getCurrentTab: () => currentTab };

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
if (calendarPageEl) calendarPageEl.style.display = 'none';
if (window.IMModule) window.IMModule.init();

loadProfile();
