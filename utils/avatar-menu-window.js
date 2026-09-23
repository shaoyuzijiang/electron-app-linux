/**
 * 头像下拉菜单悬浮窗口
 *
 * 背景：主窗口内嵌的企业 webview 是原生 WebContentsView，渲染层级永远高于
 * 主窗口自身 HTML 内容（HTML z-index 完全压不住），普通的 HTML 弹出菜单无法
 * 盖在它上面。这里改用一个独立的、无边框、透明背景、常驻置顶的子窗口来渲染
 * 头像菜单——它是操作系统级别的窗口，天然渲染在主窗口的所有子视图（包括
 * webview）之上，不需要挪动/缩放 webview 本身。
 *
 * 交互：
 *   - 显示：计算菜单实际内容尺寸后，定位到头像下方，show + focus
 *   - 隐藏：窗口失焦（blur）自动隐藏——覆盖"点击外部关闭"场景
 *   - 菜单项点击：悬浮窗内的脚本通过 IPC 把 action 发给主进程，
 *     主进程隐藏悬浮窗并把 action 转发给主窗口，由主窗口的业务逻辑执行
 */
const { BrowserWindow } = require('electron');
const path = require('path');

let overlayWindow = null;
let _getMainWindow = null;

// 时间窗口：用于识别"点击头像 → 悬浮窗失焦隐藏 → 又收到一次 show 请求"的
// 场景，此时应视为"再次点击 = 收起菜单"，而不是重新弹出
const BLUR_REOPEN_GUARD_MS = 200;
let _lastBlurHideAt = 0;

// 悬浮窗内容周围的透明缓冲区（给 box-shadow 留出渲染空间），
// 需与 avatar-menu-overlay.html 中 #menuBox 的 top/left 偏移保持一致
const SHADOW_BUFFER = 8;

/**
 * 初始化模块依赖
 * @param {Object} deps
 * @param {Function} deps.getMainWindow - 获取主窗口引用
 */
function init(deps) {
  _getMainWindow = deps.getMainWindow;
}

function _ensureWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;

  const mainWindow = _getMainWindow ? _getMainWindow() : null;

  overlayWindow = new BrowserWindow({
    width: 200,
    height: 200,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'bootstrap', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'avatar-menu-overlay.html'));

  // 失焦即隐藏：外部点击 / 切到其他窗口 / 整个 App 失焦都会触发
  overlayWindow.on('blur', () => {
    _lastBlurHideAt = Date.now();
    hideMenu();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

/**
 * 显示头像菜单（内部实现，不做 toggle 判断）
 * @param {{x:number, y:number, showEnterpriseAdmin:boolean}} opts
 *   x, y 为头像元素在主窗口内容区域内的相对坐标（getBoundingClientRect 结果），
 *   本函数负责换算为绝对屏幕坐标
 */
function showMenu(opts) {
  const mainWindow = _getMainWindow ? _getMainWindow() : null;
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false, message: '主窗口不存在' };

  const win = _ensureWindow();
  const { x, y, showEnterpriseAdmin } = opts || {};

  const doShow = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('avatar-menu-init', { showEnterpriseAdmin: !!showEnterpriseAdmin });

    // 测量菜单实际内容尺寸后再定位，避免固定尺寸导致裁切或多余空白
    win.webContents
      .executeJavaScript(
        "(function(){ var b=document.getElementById('menuBox'); if(!b) return null; " +
          'var r=b.getBoundingClientRect(); return { width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()'
      )
      .then((size) => {
        if (win.isDestroyed() || mainWindow.isDestroyed()) return;
        _positionAndShow(win, mainWindow, x, y, size);
      })
      .catch(() => {
        if (win.isDestroyed() || mainWindow.isDestroyed()) return;
        _positionAndShow(win, mainWindow, x, y, null);
      });
  };

  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', doShow);
  } else {
    doShow();
  }

  return { success: true };
}

function _positionAndShow(win, mainWindow, x, y, size) {
  const contentBounds = mainWindow.getContentBounds();
  const menuWidth = (size && size.width) || 160;
  // 兜底高度按当前菜单项数估算（5 个菜单项 + 分割线，实际以内容测量为准）
  const menuHeight = (size && size.height) || 165;
  const winWidth = menuWidth + SHADOW_BUFFER * 2;
  const winHeight = menuHeight + SHADOW_BUFFER * 2;
  win.setBounds({
    x: Math.round(contentBounds.x + (x || 0) - SHADOW_BUFFER),
    y: Math.round(contentBounds.y + (y || 0) - SHADOW_BUFFER),
    width: winWidth,
    height: winHeight,
  });
  win.show();
  win.focus();
}

/**
 * 切换头像菜单显隐（供渲染进程调用）
 * - 已显示 → 隐藏
 * - 刚因失焦而隐藏（大概率就是这次点击导致的失焦）→ 视为"再次点击 = 收起"，不重新弹出
 * - 否则 → 显示
 */
function toggleMenu(opts) {
  if (isMenuVisible()) {
    hideMenu();
    return { success: true };
  }
  if (Date.now() - _lastBlurHideAt < BLUR_REOPEN_GUARD_MS) {
    return { success: true };
  }
  return showMenu(opts);
}

function hideMenu() {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    overlayWindow.hide();
  }
  return { success: true };
}

function isMenuVisible() {
  return !!(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
}

module.exports = {
  init,
  showMenu,
  toggleMenu,
  hideMenu,
  isMenuVisible,
};
