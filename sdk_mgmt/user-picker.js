const { BrowserWindow } = require('electron');
const path = require('path');

let userPickerWindow = null;

// 依赖注入
let _wemeetSdk = null;
let _getMainWindow = null;

/**
 * 初始化模块依赖
 * @param {Object} deps
 * @param {Object} deps.wemeetSdk - SDK 原生模块
 * @param {Function} deps.getMainWindow - 获取主窗口引用
 */
function init(deps) {
  _wemeetSdk = deps.wemeetSdk;
  _getMainWindow = deps.getMainWindow;
}

/**
 * 获取会中窗口位置信息
 * @returns {object|null} { x, y, width, height } 或 null
 *
 * GetMeetingWindowInfo() 返回 JSON 字符串，结构如下：
 * {
 *   "code": 0,
 *   "msg": "",
 *   "data": {
 *     "in_meeting_mode": true,
 *     "in_screen_share_mode": false,
 *     "in_meeting_min_wnd_mode": false,
 *     "window_rect": { "x": 0, "y": 0, "width": 0, "height": 0 }
 *   }
 * }
 * 仅在会中且非屏幕共享、非最小化时 window_rect 有效。
 */
function getMeetingWindowInfo() {
  if (!_wemeetSdk) return null;
  try {
    const raw = _wemeetSdk.GetMeetingWindowInfo();
    if (!raw || raw === '') return null;
    const result = JSON.parse(raw);
    if (!result || result.code !== 0 || !result.data) return null;
    const data = result.data;
    if (!data.in_meeting_mode || data.in_screen_share_mode || data.in_meeting_min_wnd_mode) {
      console.warn('[选人组件] 会中窗口状态不适合定位:', {
        in_meeting_mode: data.in_meeting_mode,
        in_screen_share_mode: data.in_screen_share_mode,
        in_meeting_min_wnd_mode: data.in_meeting_min_wnd_mode,
      });
      return null;
    }
    const rect = data.window_rect;
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  } catch (err) {
    console.error('[选人组件] GetMeetingWindowInfo 失败:', err.message);
    return null;
  }
}

/**
 * 打开选人组件独立窗口
 * @param {string} type - 'invite_users' | 'invite_meeting' | 'add_group_members'
 * @param {string} cbMsg - SDK 回调原始 JSON 消息（invite 模式），或 JSON 字符串 { conversationId, existingMemberIds }（add_group_members 模式）
 */
function openUserPickerWindow(type, cbMsg) {
  if (userPickerWindow && !userPickerWindow.isDestroyed()) {
    userPickerWindow.close();
    userPickerWindow = null;
  }

  // 添加群成员模式始终基于主窗口定位（不在会中场景）
  const meetingWinInfo = type === 'add_group_members' ? null : getMeetingWindowInfo();
  console.log('[选人组件] 会中窗口信息:', JSON.stringify(meetingWinInfo));

  const pickerWidth = 800;
  const pickerHeight = 560;

  let posX, posY;
  if (meetingWinInfo && typeof meetingWinInfo.x === 'number' && typeof meetingWinInfo.y === 'number') {
    posX = Math.round(meetingWinInfo.x + (meetingWinInfo.width - pickerWidth) / 2);
    posY = Math.round(meetingWinInfo.y + (meetingWinInfo.height - pickerHeight) / 2);
    console.log('[选人组件] 基于 SDK 会中窗口定位:', { posX, posY });
  } else {
    const mainWindow = _getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const mainBounds = mainWindow.getBounds();
      posX = Math.round(mainBounds.x + (mainBounds.width - pickerWidth) / 2);
      posY = Math.round(mainBounds.y + (mainBounds.height - pickerHeight) / 2);
    } else {
      posX = undefined;
      posY = undefined;
    }
  }

  const titleMap = {
    invite_meeting: '邀请参会',
    invite_users: '邀请成员',
    add_group_members: '添加群成员',
  };

  userPickerWindow = new BrowserWindow({
    width: pickerWidth,
    height: pickerHeight,
    minWidth: 700,
    minHeight: 480,
    x: posX,
    y: posY,
    title: titleMap[type] || '选人',
    resizable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'bootstrap', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  userPickerWindow.loadFile(path.join(__dirname, '..', 'renderer', 'user-picker.html'));

  userPickerWindow.webContents.on('did-finish-load', () => {
    userPickerWindow.webContents.send('picker-init-data', { type, cbMsg });
  });

  userPickerWindow.on('closed', () => {
    userPickerWindow = null;
  });
}

/**
 * 关闭选人组件窗口
 */
function closeUserPickerWindow() {
  if (userPickerWindow && !userPickerWindow.isDestroyed()) {
    userPickerWindow.close();
    userPickerWindow = null;
  }
}

/**
 * 获取选人组件窗口引用
 * @returns {BrowserWindow|null}
 */
function getUserPickerWindow() {
  return userPickerWindow;
}

module.exports = {
  init,
  getMeetingWindowInfo,
  openUserPickerWindow,
  closeUserPickerWindow,
  getUserPickerWindow,
};
