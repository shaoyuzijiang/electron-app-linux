const { shell } = require('electron');
const path = require('path');
const api = require('./backend_api/api');
const tokenStore = require('./utils/token-store');

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
  } = deps;

  // ========== 通用接口 ==========

  ipcMain.handle('open-external', async (_event, { url }) => {
    await shell.openExternal(url);
  });

  // ========== 认证相关 ==========

  ipcMain.handle('login', async (_event, { email, password }) => {
    try {
      const tokenData = await api.login(email, password);
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
      return { success: true, data: result };
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
  ipcMain.handle('im-upload-file', async (_event, { filePath, filename, mimetype }) => {
    try {
      const accessToken = await getValidAccessToken();
      const fs = require('fs');
      const fileBuffer = fs.readFileSync(filePath);
      const data = await api.uploadFile(accessToken, fileBuffer, filename, mimetype);
      return { success: true, data };
    } catch (err) {
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
}

module.exports = { register };
