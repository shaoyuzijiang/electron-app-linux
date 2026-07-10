const { shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const api = require('./backend_api/api');
const tokenStore = require('./utils/token-store');
const accountStore = require('./utils/account-store');
const logger = require('./utils/logger');

// 本地缓存目录
const CACHE_DIR = path.join(app.getPath('userData'), 'cache', 'uploads');

// 确保缓存目录存在
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

// 从 path 提取文件名（如 /uploads/xxx.jpg → xxx.jpg）
function getCacheFilename(serverPath) {
  const basename = path.basename(serverPath);
  return basename || null;
}

// 获取本地缓存路径（若存在）
function getCachePath(serverPath) {
  const name = getCacheFilename(serverPath);
  if (!name) return null;
  const cachePath = path.join(CACHE_DIR, name);
  return fs.existsSync(cachePath) ? cachePath : null;
}

// 根据运行平台生成客户端类型，用于登录历史上报
function getClientType() {
  switch (process.platform) {
    case 'darwin':
      return 'mac';
    case 'win32':
      return 'win';
    case 'linux':
      return 'linux';
    default:
      return 'desktop';
  }
}

// 获取物理 CPU 架构（区分 Rosetta / Windows ARM 模拟运行）
// process.arch 反映进程架构：x64 应用在 Apple Silicon 上经 Rosetta 运行时会返回 x64，
// 此时通过 runningUnderARM64Translation 判定物理架构实际为 arm64。
function getPhysicalArch() {
  let arch = process.arch;
  try {
    const translated =
      (typeof process.runningUnderARM64Translation === 'boolean' && process.runningUnderARM64Translation) ||
      (typeof app.runningUnderARM64Translation === 'boolean' && app.runningUnderARM64Translation);
    if (translated) arch = 'arm64';
  } catch {
    // 忽略：API 不可用时回退到进程架构
  }
  return arch;
}

// 生成操作系统版本信息，用于登录历史上报（如 "macOS 14.5"、"Windows 10.0.22631"）
function getClientOs() {
  let version = '';
  try {
    version = typeof process.getSystemVersion === 'function'
      ? process.getSystemVersion()
      : require('os').release();
  } catch {
    version = require('os').release();
  }
  const arch = getPhysicalArch(); // 物理 CPU 架构，如 arm64、x64
  switch (process.platform) {
    case 'darwin':
      return `macOS ${version} (${arch})`;
    case 'win32':
      return `Windows ${version} (${arch})`;
    case 'linux':
      return `Linux ${version} (${arch})`;
    default:
      return `${process.platform} ${version} (${arch})`;
  }
}

/**
 * 注册所有 IPC 通信接口
 * @param {Object} ipcMain - Electron ipcMain
 * @param {Object} deps - 依赖注入
 * @param {Object} deps.wemeetSdk - SDK 原生模块
 * @param {Function} deps.getMainWindow - 获取主窗口引用
 * @param {Function} deps.getValidAccessToken - 获取有效 accessToken
 * @param {Function} deps.ensureSDKLoggedIn - 确保 SDK 已登录
 * @param {Function} deps.ensureSDKInitialized - 确保 SDK 已初始化
 * @param {Function} deps.sdkLogin - SDK 登录
 * @param {Function} deps.isSdkInitialized - 检查 SDK 是否已初始化
 * @param {Function} deps.isSdkLoggedIn - 检查 SDK 是否已登录
 * @param {Function} deps.setSdkLoggedIn - 设置 SDK 登录状态
 * @param {Function} deps.enableInviteCallbacks - 启用邀请回调
 * @param {Function} deps.waitSdkLogin - 等待 SDK 登录完成
 * @param {Function} deps.scheduleMeetingListRefresh - 防抖刷新会议列表
 * @param {Function} deps.startMeetingListPolling - 启动会议列表轮询
 * @param {Function} deps.stopMeetingListPolling - 停止会议列表轮询
 * @param {Function} deps.getMeetingWindowInfo - 获取会中窗口位置
 * @param {Function} deps.openUserPickerWindow - 打开选人窗口
 * @param {Function} deps.closeUserPickerWindow - 关闭选人窗口
 * @param {Function} deps.getUserPickerWindow - 获取选人窗口引用
 * @param {Function} deps.handleScheme - 处理腾讯会议 scheme 唤起 URL
 * @param {Function} deps.getPendingSchemeUrl - 获取当前挂起的 scheme URL
 * @param {Function} deps.consumePendingSchemeUrl - 取出并清除挂起的 scheme URL
 * @param {Function} deps.createWebview - 创建嵌入网页视图（多 webview：tabId 区分）
 * @param {Function} deps.resizeWebview - 调整嵌入视图位置/大小
 * @param {Function} deps.closeWebview - 关闭并销毁当前 active 嵌入视图
 * @param {Function} deps.hideWebview - 隐藏嵌入视图
 * @param {Function} deps.showWebview - 显示嵌入视图
 * @param {Function} deps.getWebviewInfo - 获取当前 webview 信息
 * @param {Function} deps.webviewGoBack - 嵌入网页后退
 * @param {Function} deps.webviewGoForward - 嵌入网页前进
 * @param {Function} deps.webviewReload - 嵌入网页刷新
 * @param {Function} deps.closeWebviewById - 关闭指定 tabId 的 webview
 * @param {Function} deps.closeAllWebviews - 关闭所有 webview（登出时调用）
 * @param {Function} deps.hideWebviewAll - 隐藏所有 webview
 * @param {Function} deps.showActiveWebview - 显示当前 active 的 webview
 * @param {Function} deps.setActiveWebview - 切换活动 webview（按 tabId）
 * @param {Function} deps.listWebviews - 列出所有 webview
 * @param {Function} deps.webviewManagerAPI - webview-manager 完整模块（用于多 webview 兼容调用）
 * @param {Object} deps.avatarMenuWindowAPI - 头像菜单悬浮窗模块（utils/avatar-menu-window.js）
 */
function register(ipcMain, deps) {
  const {
    wemeetSdk,
    getMainWindow,
    getValidAccessToken,
    ensureSDKLoggedIn,
    ensureSDKInitialized,
    sdkLogin,
    isSdkInitialized,
    isSdkLoggedIn,
    setSdkLoggedIn,
    enableInviteCallbacks,
    waitSdkLogin,
    scheduleMeetingListRefresh,
    startMeetingListPolling,
    stopMeetingListPolling,
    getMeetingWindowInfo,
    openUserPickerWindow,
    closeUserPickerWindow,
    getUserPickerWindow,
    handleScheme,
    getPendingSchemeUrl,
    consumePendingSchemeUrl,
    createWebview,
    resizeWebview,
    closeWebview,
    hideWebview,
    showWebview,
    getWebviewInfo,
    webviewGoBack,
    webviewGoForward,
    webviewReload,
    // 多 webview 扩展（多走 webviewManagerAPI 间接调用，避免重复解构）
    closeAllWebviews,
    webviewManagerAPI,
    avatarMenuWindowAPI,
  } = deps;

  // ========== 通用接口 ==========

  // 渲染进程日志转发到主进程文件日志
  ipcMain.on('renderer-log', (_event, { level, message }) => {
    logger.writeLog(level, ['[Renderer]', message]);
  });

  ipcMain.handle('open-external', async (_event, { url }) => {
    await shell.openExternal(url);
  });

  // ========== 账号历史（多账号记住密码） ==========

  // 获取已保存的账号列表（仅元信息，不含密码）
  ipcMain.handle('accounts-list', () => {
    return { success: true, data: accountStore.listAccounts() };
  });

  // 根据邮箱取出解密后的密码（前端选中历史账号后回填密码框使用）
  ipcMain.handle('accounts-get-password', (_event, { email } = {}) => {
    if (!email || typeof email !== 'string') {
      return { success: false, message: 'email 必填' };
    }
    return { success: true, password: accountStore.getPassword(email) };
  });

  // 保存或更新账号（登录成功时若勾选"记住密码"则调用）
  ipcMain.handle('accounts-save', (_event, { email, password, profile } = {}) => {
    if (!email || !password) {
      return { success: false, message: 'email 和 password 必填' };
    }
    const ok = accountStore.saveAccount({ email, password, profile });
    return { success: ok, message: ok ? null : '账号保存失败' };
  });

  // 删除单个账号
  ipcMain.handle('accounts-remove', (_event, { email } = {}) => {
    if (!email) {
      return { success: false, message: 'email 必填' };
    }
    const ok = accountStore.removeAccount(email);
    return { success: ok };
  });

  // 清空所有账号
  ipcMain.handle('accounts-clear', () => {
    accountStore.clearAccounts();
    return { success: true };
  });

  // ========== 认证相关 ==========

  ipcMain.handle('login', async (_event, { email, password }) => {
    try {
      const tokenData = await api.login(email, password, {
        clientVersion: app.getVersion(),
        clientType: getClientType(),
        clientOs: getClientOs(),
      });
      tokenStore.saveTokens(tokenData);

      const profile = await api.getProfile(tokenData.accessToken);

      (async () => {
        try {
          const initSuccess = await ensureSDKInitialized();
          if (!initSuccess) {
            console.warn('SDK 初始化失败，跳过 SDK 登录');
            return;
          }

          const idTokenData = await api.getIdToken(tokenData.accessToken);
          tokenStore.saveIdToken(idTokenData);

          if (idTokenData.ssoUrl) {
            const loginSuccess = await sdkLogin(idTokenData.ssoUrl);
            if (loginSuccess) {
              console.log('腾讯会议 SDK 登录成功');
              startMeetingListPolling();
              scheduleMeetingListRefresh();
            }
          } else {
            console.warn('SDK 登录条件不满足:', { hasSsoUrl: !!(idTokenData && idTokenData.ssoUrl) });
          }
        } catch (err) {
          console.error('SDK 登录流程异常:', err.message);
        }
      })();

      return { success: true, profile };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.on('login-success', () => {
    // 切换 HTML 前关闭所有 webview，避免注册页视图浮在主页之上
    if (closeAllWebviews) closeAllWebviews();
    else if (closeWebview) closeWebview();
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    }
  });

  ipcMain.handle('get-profile', async () => {
    try {
      const accessToken = await getValidAccessToken();
      const profile = await api.getProfile(accessToken);
      return { success: true, profile };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录' };
      }
      tokenStore.clearTokens();
      return { success: false, message: '登录已过期，请重新登录' };
    }
  });

  ipcMain.handle('logout', async () => {
    stopMeetingListPolling();

    if (wemeetSdk && isSdkLoggedIn()) {
      try {
        wemeetSdk.Logout();
        setSdkLoggedIn(false);
      } catch (err) {
        console.error('SDK 登出失败:', err.message);
      }
    }
    tokenStore.clearTokens();
    tokenStore.clearMeetingTokens();
    // 切换 HTML 前关闭所有 webview，避免主页残留的嵌入视图浮在登录页之上
    if (closeAllWebviews) closeAllWebviews();
    else if (closeWebview) closeWebview();
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
    }
    return { success: true };
  });

  ipcMain.handle('change-password', async (_event, { oldPassword, newPassword }) => {
    try {
      const accessToken = await getValidAccessToken();
      const result = await api.changePassword(accessToken, oldPassword, newPassword);
      return { success: true, message: result.message };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录，请重新登录' };
      }
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('create-meeting', async (_event, meetingData) => {
    try {
      const accessToken = await getValidAccessToken();
      const result = await api.createMeeting(accessToken, meetingData);
      // 后端返回 { meeting_number, meeting_info_list: [...] }，解包为单条会议信息
      const meetingInfo =
        (result && Array.isArray(result.meeting_info_list) && result.meeting_info_list[0]) ||
        (result && result.meeting_info) ||
        result ||
        null;
      return { success: true, data: meetingInfo };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录，请重新登录' };
      }
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('get-meeting-list', async (_event, options = {}) => {
    try {
      const accessToken = await getValidAccessToken();
      const result = await api.getMeetingList(accessToken, { instanceid: 2, ...options });
      return { success: true, data: result };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录，请重新登录' };
      }
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('update-meeting', async (_event, { meetingId, updates }) => {
    try {
      const accessToken = await getValidAccessToken();
      const result = await api.updateMeeting(accessToken, meetingId, updates);
      return { success: true, data: result };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录，请重新登录' };
      }
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('cancel-meeting', async (_event, { meetingId, reason }) => {
    try {
      const accessToken = await getValidAccessToken();
      const result = await api.cancelMeeting(accessToken, meetingId, reason || {});
      return { success: true, data: result };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录，请重新登录' };
      }
      return { success: false, message: err.message };
    }
  });

  // ========== Token 相关 ==========

  ipcMain.handle('get-sdk-token', () => {
    return tokenStore.getSdkToken() || null;
  });

  ipcMain.handle('get-id-token', () => {
    return tokenStore.getIdToken() || null;
  });

  ipcMain.handle('fetch-id-token', async () => {
    try {
      const accessToken = await getValidAccessToken();
      const idTokenData = await api.getIdToken(accessToken);
      tokenStore.saveIdToken(idTokenData);

      if (wemeetSdk && isSdkInitialized() && idTokenData.ssoUrl) {
        sdkLogin(idTokenData.ssoUrl).catch((err) => {
          console.error('重新登录 SDK 失败:', err.message);
        });
      }

      return idTokenData;
    } catch (err) {
      tokenStore.saveIdToken({ error: err.message });
      return { error: err.message };
    }
  });

  // ========== 腾讯会议 SDK IPC 接口 ==========

  ipcMain.handle('get-sdk-status', () => {
    return {
      loaded: !!wemeetSdk,
      initialized: isSdkInitialized(),
      loggedIn: isSdkLoggedIn(),
      version: wemeetSdk ? wemeetSdk.GetSDKVersion() : null,
    };
  });

  ipcMain.handle('wait-sdk-login', () => waitSdkLogin());

  ipcMain.handle('join-meeting', async (_event, { meetingCode, displayName, password }) => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.JoinMeeting(meetingCode, displayName, password || '', '', true, false, true, false, '');
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('join-meeting-by-json', async (_event, { meetingJson }) => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.JoinMeetingByJSON(meetingJson);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('quick-meeting', async () => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.QuickMeeting();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('leave-meeting', async (_event, { leaveType }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.LeaveMeeting(leaveType || 0);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-join-meeting-view', async () => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.ShowJoinMeetingView();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-schedule-meeting-view', async (_event, { meetingType }) => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.ShowScheduleMeetingView(meetingType || 0);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-meeting-setting-view', async () => {
    if (!wemeetSdk || !isSdkInitialized()) {
      return { success: false, message: 'SDK 未就绪' };
    }
    try {
      wemeetSdk.ShowMeetingSettingView();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-screen-cast-view', async () => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.ShowScreenCastView();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-pre-meeting-view', async (_event, { uiStyle, tabId } = {}) => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.ShowPreMeetingView(
        String(uiStyle || 0),
        String(tabId || 0)
      );
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('is-initialized', async () => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.IsInitialized();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('is-authorized', async () => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.IsAuthorized();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('get-current-sdk-token', async () => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      const token = wemeetSdk.GetCurrentSDKToken();
      return { success: true, data: token };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('refresh-sdk-token', async (_event, { newToken }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      const result = wemeetSdk.RefreshSDKToken(newToken);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('get-current-meeting-info', async () => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      const info = wemeetSdk.GetCurrentMeetingInfo();
      return { success: true, data: info };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('get-screen-share-info', async () => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      const info = wemeetSdk.GetScreenShareInfo();
      return { success: true, data: info };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('manipulate-window', async (_event, { action }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.ManipulateWindow(action);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('bring-in-meeting-view-top', async () => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.BringInMeetingViewTop();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('switch-caption', async (_event, { open }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.SwitchCaption(open);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('update-caption-settings', async (_event, { settingsJson }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.UpdateCaptionSettings(settingsJson);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-screen-share-view', async () => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.ShowScreenShareView();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-historical-meeting-view', async () => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.ShowHistoricalMeetingView();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-meeting-detail-view', async (_event, { meetingId, subMeetingId, startTime, isHistory }) => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      if (startTime !== undefined && isHistory !== undefined) {
        wemeetSdk.ShowMeetingDetailView(meetingId, subMeetingId, startTime, isHistory);
      } else {
        wemeetSdk.ShowMeetingDetailView(meetingId, subMeetingId);
      }
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-voice-record-view', async () => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.ShowVoiceRecordView();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-ai-assistant-view', async () => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.ShowAIAssistantView();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('set-user-configuration', async (_event, { userKey, userConfig }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.SetUserConfiguration(userKey, userConfig);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('get-user-configuration', async (_event, { userKey }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.GetUserConfiguration(userKey);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('set-proxy-info', async (_event, { proxyInfo }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.SetProxyInfo(proxyInfo);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('get-proxy-info', async () => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      const info = wemeetSdk.GetProxyInfo();
      return { success: true, data: info };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('enable-address-book-callback', async (_event, { enable, show }) => {
    if (!wemeetSdk || !isSdkInitialized()) {
      return { success: false, message: 'SDK 未初始化' };
    }
    try {
      wemeetSdk.EnableAddressBookCallback(enable, show);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('set-need-meeting-info-callback', async (_event, { enable, show }) => {
    if (!wemeetSdk || !isSdkInitialized()) {
      return { success: false, message: 'SDK 未初始化' };
    }
    try {
      wemeetSdk.SetNeedMeetingInfoCallback(enable, show);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('subscribe-in-meeting-action-event', async (_event, { actionType, subscribe, subscriptionJson }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      const result = wemeetSdk.SubscribeInMeetingActionEvent(
        String(actionType),
        subscribe,
        subscriptionJson || ''
      );
      return { success: true, data: result };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('switch-layout', async (_event, { layoutJson }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.SwitchLayout(layoutJson);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('enable-ring-invitation-view', async (_event, { enable }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.EnableRingInvitationView(enable);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('handle-ring-invitation', async (_event, { accept, inviteId }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.HandleRingInvitation(accept, inviteId);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('login-by-sso', async (_event, { ssoUrl }) => {
    if (!wemeetSdk || !isSdkInitialized()) {
      return { success: false, message: 'SDK 未初始化' };
    }
    try {
      wemeetSdk.Login(ssoUrl);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('jump-url-with-login-status', async (_event, { url }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.JumpUrlWithLoginStatus(url);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('get-url-with-login-status', async (_event, { url }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      const resultUrl = wemeetSdk.GetUrlWithLoginStatus(url);
      return { success: true, data: resultUrl };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('show-upload-logs-view', async () => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.ShowUploadLogsView();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // ========== 通讯录/选人组件 IPC 接口 ==========

  ipcMain.handle('get-department-tree', async () => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getDepartmentTree(accessToken);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录，请重新登录' };
      }
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('get-department-users', async (_event, { departmentId, recursive, page, pageSize }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getDepartmentUsers(accessToken, departmentId, { recursive, page, pageSize });
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录，请重新登录' };
      }
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('search-users', async (_event, { query }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.searchUsers(accessToken, query);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录，请重新登录' };
      }
      return { success: false, message: err.message };
    }
  });

  // ========== 会中选人组件 IPC 接口 ==========

  ipcMain.handle('get-meeting-window-info', async () => {
    const info = getMeetingWindowInfo();
    return { success: !!info, data: info };
  });

  ipcMain.handle('close-user-picker-window', async () => {
    closeUserPickerWindow();
    return { success: true };
  });

  ipcMain.handle('enable-invite-callbacks', async () => {
    if (!wemeetSdk || !isSdkInitialized()) {
      return { success: false, message: 'SDK 未初始化' };
    }
    try {
      enableInviteCallbacks();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('add-users-with-param', async (_event, { jsonParam }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.AddUsersWithParam(jsonParam);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // ========== IM 即时通讯 IPC 接口 ==========

  // 获取 accessToken（供渲染进程建立 WebSocket 连接）
  ipcMain.handle('get-access-token', async () => {
    try {
      const accessToken = await getValidAccessToken();
      return { success: true, accessToken };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // 获取 WebSocket URL
  ipcMain.handle('get-ws-url', () => {
    return { success: true, url: api.getWsUrl() };
  });

  // 获取文件完整 URL
  ipcMain.handle('get-file-url', (_event, { path }) => {
    return { success: true, url: api.getFileUrl(path) };
  });

  // 获取图片数据（base64 data URL，带本地缓存）
  ipcMain.handle('fetch-image-data', async (_event, { path: serverPath }) => {
    try {
      ensureCacheDir();

      // 1. 检查本地缓存
      const cachePath = getCachePath(serverPath);
      if (cachePath) {
        const buffer = fs.readFileSync(cachePath);
        const ext = path.extname(cachePath).toLowerCase();
        const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
        const contentType = mimeMap[ext] || 'image/png';
        return { success: true, data: `data:${contentType};base64,${buffer.toString('base64')}` };
      }

      // 2. 从服务器下载
      const accessToken = await getValidAccessToken();
      const url = api.getFileUrl(serverPath);
      console.log(`[IM] fetch-image-data: GET ${url}`);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers['content-type'] || 'image/png';

      // 3. 写入本地缓存
      const name = getCacheFilename(serverPath);
      if (name) {
        const cacheFilePath = path.join(CACHE_DIR, name);
        fs.writeFileSync(cacheFilePath, buffer);
        console.log(`[IM] 图片已缓存: ${cacheFilePath} (${buffer.length} bytes)`);
      }

      const b64 = buffer.toString('base64');
      return { success: true, data: `data:${contentType};base64,${b64}` };
    } catch (err) {
      console.error(`[IM] fetch-image-data 失败:`, err.message);
      return { success: false, message: err.message };
    }
  });

  // 打开/下载文件（带本地缓存）
  ipcMain.handle('open-cached-file', async (_event, { path: serverPath, filename }) => {
    try {
      ensureCacheDir();

      // 1. 检查本地缓存
      let cachePath = getCachePath(serverPath);

      // 2. 没有缓存则从服务器下载
      if (!cachePath) {
        const accessToken = await getValidAccessToken();
        const url = api.getFileUrl(serverPath);
        console.log(`[IM] open-cached-file: GET ${url}`);
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const name = getCacheFilename(serverPath);
        if (name) {
          cachePath = path.join(CACHE_DIR, name);
          fs.writeFileSync(cachePath, buffer);
          console.log(`[IM] 文件已缓存: ${cachePath} (${buffer.length} bytes)`);
        }
      }

      if (cachePath) {
        // 用系统默认程序打开
        shell.openPath(cachePath);
        return { success: true };
      }
      return { success: false, message: '无法获取文件' };
    } catch (err) {
      console.error(`[IM] open-cached-file 失败:`, err.message);
      return { success: false, message: err.message };
    }
  });

  // 获取会话列表
  ipcMain.handle('im-get-conversations', async () => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getConversations(accessToken);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 创建会话
  ipcMain.handle('im-create-conversation', async (_event, { type, name, memberIds }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.createConversation(accessToken, { type, name, memberIds });
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 获取会话详情
  ipcMain.handle('im-get-conversation-detail', async (_event, { conversationId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getConversationDetail(accessToken, conversationId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 获取历史消息
  ipcMain.handle('im-get-messages', async (_event, { conversationId, before, after, limit }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getMessages(accessToken, conversationId, { before, after, limit });
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 发送消息（HTTP 备用）
  ipcMain.handle('im-send-message', async (_event, { conversationId, type, content }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.sendMessageHttp(accessToken, conversationId, { type, content });
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 标记已读
  ipcMain.handle('im-mark-read', async (_event, { conversationId }) => {
    try {
      const accessToken = await getValidAccessToken();
      await api.markConversationRead(accessToken, conversationId);
      return { success: true };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 获取会话成员
  ipcMain.handle('im-get-members', async (_event, { conversationId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getConversationMembers(accessToken, conversationId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 添加成员
  ipcMain.handle('im-add-member', async (_event, { conversationId, userId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.addConversationMember(accessToken, conversationId, userId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 移除成员
  ipcMain.handle('im-remove-member', async (_event, { conversationId, userId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.removeConversationMember(accessToken, conversationId, userId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 修改群聊信息（群名/群头像）
  ipcMain.handle('im-update-conversation', async (_event, { conversationId, name, avatar }) => {
    try {
      const accessToken = await getValidAccessToken();
      const params = {};
      if (name !== undefined && name !== null) params.name = name;
      if (avatar !== undefined && avatar !== null) params.avatar = avatar;
      const data = await api.updateConversation(accessToken, conversationId, params);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 解散群聊
  ipcMain.handle('im-dissolve-conversation', async (_event, { conversationId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.dissolveConversation(accessToken, conversationId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 转让群主
  ipcMain.handle('im-transfer-ownership', async (_event, { conversationId, userId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.transferOwnership(accessToken, conversationId, userId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 设置/取消管理员
  ipcMain.handle('im-set-member-role', async (_event, { conversationId, userId, role }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.setMemberRole(accessToken, conversationId, userId, role);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 打开选人组件添加群成员
  ipcMain.handle('im-open-add-member-picker', async (_event, { conversationId, existingMemberIds }) => {
    try {
      const cbMsg = JSON.stringify({ conversationId, existingMemberIds: existingMemberIds || [] });
      openUserPickerWindow('add_group_members', cbMsg);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // 选人组件添加群成员完成通知 → 转发给主窗口刷新
  ipcMain.on('im-add-member-done', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('im-add-member-done');
    }
  });

  // 获取总未读数
  ipcMain.handle('im-get-unread-count', async () => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getUnreadCount(accessToken);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 获取在线用户
  ipcMain.handle('im-get-online-users', async () => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getOnlineUsers(accessToken);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 上传文件
  ipcMain.handle('im-upload-file', async (_event, { filePath, filename, mimetype, fileData }) => {
    try {
      const accessToken = await getValidAccessToken();
      console.log('[IM-Upload] 开始上传:', { filePath, filename, mimetype, hasFileData: !!fileData, dataSize: fileData?.byteLength || 'N/A', tokenPrefix: accessToken?.substring(0, 20) + '...' });

      let fileBuffer;
      if (fileData && fileData.byteLength) {
        // 前端通过 FileReader 读取的数据（ArrayBuffer）
        fileBuffer = Buffer.from(fileData);
        console.log('[IM-Upload] 使用前端数据，buffer大小:', fileBuffer.length);
      } else {
        // 回退到从磁盘路径读取
        const fs = require('fs');
        if (!filePath) throw new Error('未提供文件路径或数据');
        fileBuffer = fs.readFileSync(filePath);
        console.log('[IM-Upload] 从磁盘读取文件，buffer大小:', fileBuffer.length);
      }
      const data = await api.uploadFile(accessToken, fileBuffer, filename, mimetype);
      return { success: true, data };
    } catch (err) {
      console.error('[IM-Upload] 上传失败:', err.message);
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // IM 用户搜索（复用 user-picker/search 接口）
  ipcMain.handle('im-search-users', async (_event, { keyword }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.searchUsers(accessToken, keyword);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('enable-custom-org-info', async (_event, { enable }) => {
    if (!wemeetSdk || !isSdkInitialized()) {
      return { success: false, message: 'SDK 未初始化' };
    }
    try {
      wemeetSdk.EnableCustomOrgInfo(enable);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('set-custom-org-info', async (_event, { jsonParam }) => {
    if (!wemeetSdk) {
      return { success: false, message: 'SDK 未加载' };
    }
    try {
      wemeetSdk.SetCustomOrgInfo(jsonParam);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // ========== 日程（calendar）IPC 接口 ==========

  // 创建日程
  ipcMain.handle('calendar-create-event', async (_event, params) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.createEvent(accessToken, params);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 日程列表
  ipcMain.handle('calendar-get-events', async (_event, options = {}) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getEvents(accessToken, options);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 日程详情
  ipcMain.handle('calendar-get-event-detail', async (_event, { eventId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getEventDetail(accessToken, eventId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 修改日程
  ipcMain.handle('calendar-update-event', async (_event, { eventId, params }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.updateEvent(accessToken, eventId, params);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 取消日程
  ipcMain.handle('calendar-cancel-event', async (_event, { eventId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.cancelEvent(accessToken, eventId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 添加参与者
  ipcMain.handle('calendar-add-participant', async (_event, { eventId, userId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.addEventParticipant(accessToken, eventId, userId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 删除参与者
  ipcMain.handle('calendar-remove-participant', async (_event, { eventId, userId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.removeEventParticipant(accessToken, eventId, userId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 参与者列表
  ipcMain.handle('calendar-get-participants', async (_event, { eventId }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getEventParticipants(accessToken, eventId);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });

  // 查询空闲时间
  ipcMain.handle('calendar-get-freebusy', async (_event, params) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getFreeBusy(accessToken, params);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
      return { success: false, message: err.message };
    }
  });
  // ========== URL Scheme 唤起接口 ==========

  // 查询当前挂起的 scheme URL（用于渲染进程在登录页展示提示）
  ipcMain.handle('get-pending-scheme-url', () => {
    return { success: true, url: getPendingSchemeUrl ? getPendingSchemeUrl() : null };
  });

  // 取出并清除挂起的 scheme URL（标记渲染进程已处理）
  ipcMain.handle('consume-pending-scheme-url', () => {
    return { success: true, url: consumePendingSchemeUrl ? consumePendingSchemeUrl() : null };
  });

  // 主动调用 SDK 处理 scheme URL（在 SDK 已登录后由渲染进程触发）
  ipcMain.handle('handle-scheme', async (_event, { url } = {}) => {
    const target = url || (getPendingSchemeUrl ? getPendingSchemeUrl() : null);
    if (!target) {
      return { success: false, message: '无可处理的 scheme URL' };
    }
    if (consumePendingSchemeUrl) consumePendingSchemeUrl();
    if (!handleScheme) {
      return { success: false, message: 'handleScheme 未注入' };
    }
    return await handleScheme(target);
  });

  // ========== Webview 嵌入网页接口 ==========

  ipcMain.handle('webview-create', async (_event, { tabId, url, bounds, options }) => {
    if (!createWebview) {
      return { success: false, message: 'webview 模块未注入' };
    }
    return createWebview(tabId, url, bounds, options || {});
  });

  ipcMain.handle('webview-resize', async (_event, { bounds }) => {
    if (resizeWebview) resizeWebview(bounds);
    return { success: true };
  });

  // 关闭指定 tabId 的 webview；不传 tabId 时关闭当前 active
  ipcMain.handle('webview-close', async (_event, { tabId } = {}) => {
    if (typeof tabId === 'string' && tabId) {
      return webviewManagerAPI.closeWebviewById(tabId);
    }
    if (closeWebview) return closeWebview();
    return { success: true };
  });

  // 关闭所有 webview（用于登出场景）
  ipcMain.handle('webview-close-all', async () => {
    if (webviewManagerAPI.closeAllWebviews) {
      return webviewManagerAPI.closeAllWebviews();
    }
    return { success: true };
  });

  // 隐藏所有 webview（切到非 webview tab 时）
  ipcMain.handle('webview-hide', async () => {
    if (webviewManagerAPI.hideWebviewAll) {
      return webviewManagerAPI.hideWebviewAll();
    }
    if (hideWebview) return hideWebview();
    return { success: true };
  });

  // 显示指定 tabId 的 webview（同时隐藏其他）
  ipcMain.handle('webview-show', async (_event, { tabId } = {}) => {
    if (typeof tabId === 'string' && tabId) {
      return webviewManagerAPI.setActive(tabId);
    }
    if (webviewManagerAPI.showActiveWebview) {
      return webviewManagerAPI.showActiveWebview();
    }
    if (showWebview) return showWebview();
    return { success: true };
  });

  ipcMain.handle('webview-get-info', async (_event, { tabId } = {}) => {
    if (typeof tabId === 'string' && tabId) {
      if (webviewManagerAPI.getWebviewInfo) return webviewManagerAPI.getWebviewInfo(tabId);
    }
    if (getWebviewInfo) return getWebviewInfo();
    return { success: false, message: 'webview 模块未注入' };
  });

  // 列出所有 webview
  ipcMain.handle('webview-list', async () => {
    if (webviewManagerAPI.listWebviews) return webviewManagerAPI.listWebviews();
    return { success: true, data: [], activeTabId: null };
  });

  ipcMain.handle('webview-go-back', async (_event, { tabId } = {}) => {
    if (webviewGoBack) return webviewGoBack(tabId);
    return { success: true };
  });

  ipcMain.handle('webview-go-forward', async (_event, { tabId } = {}) => {
    if (webviewGoForward) return webviewGoForward(tabId);
    return { success: true };
  });

  ipcMain.handle('webview-reload', async (_event, { tabId } = {}) => {
    if (webviewReload) return webviewReload(tabId);
    return { success: true };
  });

  // ========== Web SSO 免登接口 ==========

  // 颁发一次性 SSO Ticket（APP 用 Bearer Token 申请）
  ipcMain.handle('sso-request-ticket', async (_event, { audience, target, nonce } = {}) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.requestSsoTicket(accessToken, { audience, target, nonce });
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录，请重新登录' };
      }
      return { success: false, message: err.message };
    }
  });

  // ========== 头像菜单悬浮窗接口 ==========
  // 详见 utils/avatar-menu-window.js 顶部说明：用独立子窗口盖在 webview 上面，
  // 避免 HTML z-index 压不过 WebContentsView 的问题。

  // 切换显隐（点击头像时调用）
  ipcMain.handle('avatar-menu-toggle', async (_event, opts) => {
    if (avatarMenuWindowAPI && avatarMenuWindowAPI.toggleMenu) {
      return avatarMenuWindowAPI.toggleMenu(opts);
    }
    return { success: false, message: '头像菜单模块未注入' };
  });

  // 主动隐藏（菜单项点击后 / 其他需要强制关闭的场景）
  ipcMain.handle('avatar-menu-hide', async () => {
    if (avatarMenuWindowAPI && avatarMenuWindowAPI.hideMenu) {
      return avatarMenuWindowAPI.hideMenu();
    }
    return { success: true };
  });

  // 悬浮窗内菜单项被点击：隐藏悬浮窗 + 把 action 转发给主窗口执行实际业务逻辑
  // （修改密码 / 上传日志 / 企业管理 / 退出登录 均由主窗口渲染进程处理，
  //  悬浮窗本身只负责展示 UI 和上报点击）
  ipcMain.on('avatar-menu-item-click', (_event, action) => {
    if (avatarMenuWindowAPI && avatarMenuWindowAPI.hideMenu) {
      avatarMenuWindowAPI.hideMenu();
    }
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('avatar-menu-action', action);
    }
  });
}

module.exports = { register };
