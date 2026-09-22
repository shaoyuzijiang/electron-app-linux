/**
 * 「会议设置」对话框窗口
 *
 * 展示并编辑腾讯会议 SDK UserConfigService 的全部用户配置项
 * （GetUserConfiguration / SetUserConfiguration，参见官方接口文档）。
 *
 * 交互：
 *   - 模态子窗口（parent 为主窗口），点击 ✕ / Esc 关闭；失焦不自动关闭
 *     （用户可能切出去对照资料，与「关于」弹窗行为不同）
 *   - 页面（renderer/meeting-settings.html）通过 preload 暴露的 IPC 与主进程通信：
 *     getUserConfigValue(key) / setUserConfigValue(key, value)，
 *     均为 Promise 化（内部等待 SDK 异步回调，见 ipc-handlers.js）
 */
const { BrowserWindow } = require('electron');
const path = require('path');

let settingsWindow = null;

/**
 * 显示「会议设置」窗口（已打开则置前）
 * @param {BrowserWindow|null} mainWindow - 主窗口引用
 */
function showMeetingSettingsWindow(mainWindow) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

  settingsWindow = new BrowserWindow({
    width: 580,
    height: 680,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    parent,
    modal: !!parent,
    webPreferences: {
      preload: path.join(__dirname, '..', 'bootstrap', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.once('ready-to-show', () => settingsWindow.show());

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'meeting-settings.html'));
}

function closeMeetingSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
}

module.exports = {
  showMeetingSettingsWindow,
  closeMeetingSettingsWindow,
};
