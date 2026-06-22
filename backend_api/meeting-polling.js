const api = require('./api');

let meetingListRefreshTimer = null;
let pollingTimer = null;
const POLLING_INTERVAL = 5 * 60 * 1000; // 5 分钟

// 依赖注入
let _getValidAccessToken = null;
let _getMainWindow = null;
let _isSdkLoggedIn = null;

/**
 * 初始化模块依赖
 * @param {Object} deps
 * @param {Function} deps.getValidAccessToken - 获取有效 accessToken
 * @param {Function} deps.getMainWindow - 获取主窗口引用
 * @param {Function} deps.isSdkLoggedIn - 检查 SDK 是否已登录
 */
function init(deps) {
  _getValidAccessToken = deps.getValidAccessToken;
  _getMainWindow = deps.getMainWindow;
  _isSdkLoggedIn = deps.isSdkLoggedIn;
}

/**
 * 防抖刷新会议列表并推送给渲染进程
 */
function scheduleMeetingListRefresh() {
  if (meetingListRefreshTimer) clearTimeout(meetingListRefreshTimer);
  meetingListRefreshTimer = setTimeout(async () => {
    try {
      const accessToken = await _getValidAccessToken();
      const result = await api.getMeetingList(accessToken, { instanceid: 2, is_show_all_sub_meetings: '1' });
      const mainWindow = _getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('meeting-list-updated', { success: true, data: result });
      }
    } catch (err) {
      console.error('推送会议列表失败:', err.message);
    }
  }, 300);
}

/**
 * 启动会议列表定时轮询
 */
function startMeetingListPolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    if (!_isSdkLoggedIn()) return;
    const mainWindow = _getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    scheduleMeetingListRefresh();
  }, POLLING_INTERVAL);
  console.log('[会议列表轮询] 已启动，间隔', POLLING_INTERVAL / 1000, '秒');
}

/**
 * 停止会议列表定时轮询
 */
function stopMeetingListPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log('[会议列表轮询] 已停止');
  }
}

module.exports = {
  init,
  scheduleMeetingListRefresh,
  startMeetingListPolling,
  stopMeetingListPolling,
};
