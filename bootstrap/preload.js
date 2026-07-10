const { contextBridge, ipcRenderer } = require('electron');

// 开发模式标志：主进程通过 additionalArguments 传入 --is-dev=1/0
// 原因：process.defaultApp 在 preload 上下文不可靠（npm scripts 启动、打包后行为不一致）
const isDev = process.argv.includes('--is-dev=1');

contextBridge.exposeInMainWorld('electronAPI', {
  // 运行环境标志
  isDev,
  // 原有接口
  login: (email, password) => ipcRenderer.invoke('login', { email, password }),
  loginSuccess: () => ipcRenderer.send('login-success'),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  logout: () => ipcRenderer.invoke('logout'),
  changePassword: (oldPassword, newPassword) => ipcRenderer.invoke('change-password', { oldPassword, newPassword }),
  openExternal: (url) => ipcRenderer.invoke('open-external', { url }),
  createMeeting: (meetingData) => ipcRenderer.invoke('create-meeting', meetingData),
  getMeetingList: (options) => ipcRenderer.invoke('get-meeting-list', options),
  updateMeeting: (meetingId, updates) => ipcRenderer.invoke('update-meeting', { meetingId, updates }),
  cancelMeeting: (meetingId, reason) => ipcRenderer.invoke('cancel-meeting', { meetingId, reason }),
  getSdkToken: () => ipcRenderer.invoke('get-sdk-token'),
  getIdToken: () => ipcRenderer.invoke('get-id-token'),
  fetchIdToken: () => ipcRenderer.invoke('fetch-id-token'),

  // 腾讯会议 SDK 接口
  getSdkStatus: () => ipcRenderer.invoke('get-sdk-status'),
  waitSdkLogin: () => ipcRenderer.invoke('wait-sdk-login'),
  joinMeeting: (meetingCode, displayName, password) =>
    ipcRenderer.invoke('join-meeting', { meetingCode, displayName, password }),
  joinMeetingByJson: (meetingJson) =>
    ipcRenderer.invoke('join-meeting-by-json', { meetingJson }),
  quickMeeting: () => ipcRenderer.invoke('quick-meeting'),
  leaveMeeting: (leaveType) => ipcRenderer.invoke('leave-meeting', { leaveType }),
  showPreMeetingView: () => ipcRenderer.invoke('show-pre-meeting-view'),
  showJoinMeetingView: () => ipcRenderer.invoke('show-join-meeting-view'),
  showScheduleMeetingView: (meetingType) =>
    ipcRenderer.invoke('show-schedule-meeting-view', { meetingType }),
  showMeetingSettingView: () => ipcRenderer.invoke('show-meeting-setting-view'),
  showScreenCastView: () => ipcRenderer.invoke('show-screen-cast-view'),
  showUploadLogsView: () => ipcRenderer.invoke('show-upload-logs-view'),

  // 监听 SDK 回调
  onSdkCallback: (callback) => {
    ipcRenderer.on('sdk-callback', (_event, msg) => callback(msg));
  },

  // 监听会议列表推送更新
  onMeetingListUpdate: (callback) => {
    ipcRenderer.on('meeting-list-updated', (_event, data) => callback(data));
  },

  // 选人组件接口
  getDepartmentTree: () => ipcRenderer.invoke('get-department-tree'),
  getDepartmentUsers: (departmentId, recursive, page, pageSize) =>
    ipcRenderer.invoke('get-department-users', { departmentId, recursive, page, pageSize }),
  searchUsers: (query) => ipcRenderer.invoke('search-users', { query }),

  // 会中选人组件接口
  enableInviteCallbacks: () => ipcRenderer.invoke('enable-invite-callbacks'),
  addUsersWithParam: (jsonParam) =>
    ipcRenderer.invoke('add-users-with-param', { jsonParam }),
  enableCustomOrgInfo: (enable) =>
    ipcRenderer.invoke('enable-custom-org-info', { enable }),
  setCustomOrgInfo: (jsonParam) =>
    ipcRenderer.invoke('set-custom-org-info', { jsonParam }),

  // 新增 SDK 接口
  isInitialized: () => ipcRenderer.invoke('is-initialized'),
  isAuthorized: () => ipcRenderer.invoke('is-authorized'),
  getCurrentSdkToken: () => ipcRenderer.invoke('get-current-sdk-token'),
  refreshSdkToken: (newToken) =>
    ipcRenderer.invoke('refresh-sdk-token', { newToken }),
  getCurrentMeetingInfo: () => ipcRenderer.invoke('get-current-meeting-info'),
  getScreenShareInfo: () => ipcRenderer.invoke('get-screen-share-info'),
  manipulateWindow: (action) =>
    ipcRenderer.invoke('manipulate-window', { action }),
  bringInMeetingViewTop: () => ipcRenderer.invoke('bring-in-meeting-view-top'),
  switchCaption: (open) =>
    ipcRenderer.invoke('switch-caption', { open }),
  updateCaptionSettings: (settingsJson) =>
    ipcRenderer.invoke('update-caption-settings', { settingsJson }),
  showScreenShareView: () => ipcRenderer.invoke('show-screen-share-view'),
  showHistoricalMeetingView: () =>
    ipcRenderer.invoke('show-historical-meeting-view'),
  showMeetingDetailView: (meetingId, subMeetingId, startTime, isHistory) =>
    ipcRenderer.invoke('show-meeting-detail-view', { meetingId, subMeetingId, startTime, isHistory }),
  showVoiceRecordView: () => ipcRenderer.invoke('show-voice-record-view'),
  showAIAssistantView: () => ipcRenderer.invoke('show-ai-assistant-view'),
  setUserConfiguration: (userKey, userConfig) =>
    ipcRenderer.invoke('set-user-configuration', { userKey, userConfig }),
  getUserConfiguration: (userKey) =>
    ipcRenderer.invoke('get-user-configuration', { userKey }),
  setProxyInfo: (proxyInfo) =>
    ipcRenderer.invoke('set-proxy-info', { proxyInfo }),
  getProxyInfo: () => ipcRenderer.invoke('get-proxy-info'),
  enableAddressBookCallback: (enable, show) =>
    ipcRenderer.invoke('enable-address-book-callback', { enable, show }),
  setNeedMeetingInfoCallback: (enable, show) =>
    ipcRenderer.invoke('set-need-meeting-info-callback', { enable, show }),
  subscribeInMeetingActionEvent: (actionType, subscribe, subscriptionJson) =>
    ipcRenderer.invoke('subscribe-in-meeting-action-event', { actionType, subscribe, subscriptionJson }),
  switchLayout: (layoutJson) =>
    ipcRenderer.invoke('switch-layout', { layoutJson }),
  enableRingInvitationView: (enable) =>
    ipcRenderer.invoke('enable-ring-invitation-view', { enable }),
  handleRingInvitation: (accept, inviteId) =>
    ipcRenderer.invoke('handle-ring-invitation', { accept, inviteId }),
  loginBySso: (ssoUrl) =>
    ipcRenderer.invoke('login-by-sso', { ssoUrl }),
  jumpUrlWithLoginStatus: (url) =>
    ipcRenderer.invoke('jump-url-with-login-status', { url }),
  getUrlWithLoginStatus: (url) =>
    ipcRenderer.invoke('get-url-with-login-status', { url }),

  // 选人组件独立窗口接口
  getMeetingWindowInfo: () => ipcRenderer.invoke('get-meeting-window-info'),
  closeUserPickerWindow: () => ipcRenderer.invoke('close-user-picker-window'),

  // 监听选人组件初始化数据（主进程发送）
  onPickerInitData: (callback) => {
    ipcRenderer.on('picker-init-data', (_event, data) => callback(data));
  },

  // 监听邀请结果回调
  onAddUsersResultCallback: (callback) => {
    ipcRenderer.on('add-users-result-callback', (_event, msg) => callback(msg));
  },

  // ========== IM 即时通讯接口 ==========
  getAccessToken: () => ipcRenderer.invoke('get-access-token'),
  getWsUrl: () => ipcRenderer.invoke('get-ws-url'),
  getFileUrl: (path) => ipcRenderer.invoke('get-file-url', { path }),
  imGetConversations: () => ipcRenderer.invoke('im-get-conversations'),
  imCreateConversation: (type, name, memberIds) =>
    ipcRenderer.invoke('im-create-conversation', { type, name, memberIds }),
  imGetConversationDetail: (conversationId) =>
    ipcRenderer.invoke('im-get-conversation-detail', { conversationId }),
  imGetMessages: (conversationId, options) =>
    ipcRenderer.invoke('im-get-messages', { conversationId, ...options }),
  imSendMessage: (conversationId, type, content) =>
    ipcRenderer.invoke('im-send-message', { conversationId, type, content }),
  imMarkRead: (conversationId) =>
    ipcRenderer.invoke('im-mark-read', { conversationId }),
  imGetMembers: (conversationId) =>
    ipcRenderer.invoke('im-get-members', { conversationId }),
  imAddMember: (conversationId, userId) =>
    ipcRenderer.invoke('im-add-member', { conversationId, userId }),
  imRemoveMember: (conversationId, userId) =>
    ipcRenderer.invoke('im-remove-member', { conversationId, userId }),
  imUpdateConversation: (conversationId, name, avatar) =>
    ipcRenderer.invoke('im-update-conversation', { conversationId, name, avatar }),
  imDissolveConversation: (conversationId) =>
    ipcRenderer.invoke('im-dissolve-conversation', { conversationId }),
  imTransferOwnership: (conversationId, userId) =>
    ipcRenderer.invoke('im-transfer-ownership', { conversationId, userId }),
  imSetMemberRole: (conversationId, userId, role) =>
    ipcRenderer.invoke('im-set-member-role', { conversationId, userId, role }),
  imOpenAddMemberPicker: (conversationId, existingMemberIds) =>
    ipcRenderer.invoke('im-open-add-member-picker', { conversationId, existingMemberIds }),
  notifyAddMemberDone: () => ipcRenderer.send('im-add-member-done'),
  onAddMemberDone: (callback) => {
    ipcRenderer.on('im-add-member-done', () => callback());
  },
  imGetUnreadCount: () => ipcRenderer.invoke('im-get-unread-count'),
  imGetOnlineUsers: () => ipcRenderer.invoke('im-get-online-users'),
  imUploadFile: (filePath, filename, mimetype, fileData) =>
    ipcRenderer.invoke('im-upload-file', { filePath, filename, mimetype, fileData }),
  imSearchUsers: (keyword) =>
    ipcRenderer.invoke('im-search-users', { keyword }),
  fetchImageData: (path) =>
    ipcRenderer.invoke('fetch-image-data', { path }),
  openCachedFile: (path, filename) =>
    ipcRenderer.invoke('open-cached-file', { path, filename }),

  // 渲染进程日志转发
  rendererLog: (level, message) =>
    ipcRenderer.send('renderer-log', { level, message }),

  // ========== 日程（calendar）接口 ==========
  calendarCreateEvent: (params) => ipcRenderer.invoke('calendar-create-event', params),
  calendarGetEvents: (options) => ipcRenderer.invoke('calendar-get-events', options || {}),
  calendarGetEventDetail: (eventId) =>
    ipcRenderer.invoke('calendar-get-event-detail', { eventId }),
  calendarUpdateEvent: (eventId, params) =>
    ipcRenderer.invoke('calendar-update-event', { eventId, params }),
  calendarCancelEvent: (eventId) =>
    ipcRenderer.invoke('calendar-cancel-event', { eventId }),
  calendarAddParticipant: (eventId, userId) =>
    ipcRenderer.invoke('calendar-add-participant', { eventId, userId }),
  calendarRemoveParticipant: (eventId, userId) =>
    ipcRenderer.invoke('calendar-remove-participant', { eventId, userId }),
  calendarGetParticipants: (eventId) =>
    ipcRenderer.invoke('calendar-get-participants', { eventId }),
  calendarGetFreeBusy: (params) =>
    ipcRenderer.invoke('calendar-get-freebusy', params),

  // ========== URL Scheme 唤起接口 ==========
  // 查询当前挂起的 scheme URL（用于登录页展示"会议邀请待加入"提示）
  getPendingSchemeUrl: () => ipcRenderer.invoke('get-pending-scheme-url'),
  // 取出并清除挂起的 scheme URL
  consumePendingSchemeUrl: () => ipcRenderer.invoke('consume-pending-scheme-url'),
  // 主动触发 SDK 处理 scheme URL（传入 url 可覆盖默认的 pending URL）
  handleScheme: (url) => ipcRenderer.invoke('handle-scheme', { url }),

  // ========== Webview 嵌入网页接口 ==========
  // 多 webview 支持：每个调用都可指定 tabId，未传则保持向后兼容（默认 'webview'）
  webviewCreate: (url, bounds, options) => {
    const tabId = options && options.tabId ? options.tabId : 'webview';
    return ipcRenderer.invoke('webview-create', { tabId, url, bounds, options: options || {} });
  },
  webviewResize: (bounds) =>
    ipcRenderer.invoke('webview-resize', { bounds }),
  webviewClose: (tabId) => ipcRenderer.invoke('webview-close', { tabId }),
  webviewCloseAll: () => ipcRenderer.invoke('webview-close-all'),
  webviewHide: () => ipcRenderer.invoke('webview-hide'),
  webviewShow: (tabId) => ipcRenderer.invoke('webview-show', { tabId }),
  webviewGetInfo: (tabId) => ipcRenderer.invoke('webview-get-info', { tabId }),
  webviewList: () => ipcRenderer.invoke('webview-list'),
  webviewGoBack: (tabId) => ipcRenderer.invoke('webview-go-back', { tabId }),
  webviewGoForward: (tabId) => ipcRenderer.invoke('webview-go-forward', { tabId }),
  webviewReload: (tabId) => ipcRenderer.invoke('webview-reload', { tabId }),

  // 监听 webview 标题更新（动态页签显示用）
  onWebviewTitleUpdated: (callback) => {
    ipcRenderer.on('webview-title-updated', (_event, data) => callback(data));
  },

  // 监听 webview 跳转链（含 302 重定向、最终落地、加载失败），用于 SSO 失败诊断
  // payload: { tabId, type: 'start' | 'redirect' | 'navigate' | 'navigate-in-page' | 'fail',
  //            url, errorCode?, errorDescription?, chain: [...] }
  onWebviewNavigation: (callback) => {
    ipcRenderer.on('webview-navigation', (_event, data) => callback(data));
  },

  // ========== Web SSO 免登接口 ==========
  ssoRequestTicket: (audience, target, nonce) =>
    ipcRenderer.invoke('sso-request-ticket', { audience, target, nonce }),

  // ========== 头像菜单悬浮窗接口 ==========
  // 供主窗口调用：切换/隐藏悬浮菜单，监听菜单项点击后转发回来的 action
  avatarMenuToggle: (opts) => ipcRenderer.invoke('avatar-menu-toggle', opts),
  avatarMenuHide: () => ipcRenderer.invoke('avatar-menu-hide'),
  onAvatarMenuAction: (callback) => {
    ipcRenderer.on('avatar-menu-action', (_event, action) => callback(action));
  },
  // 供悬浮窗自身（avatar-menu-overlay.html）调用：接收初始化数据、上报点击
  onAvatarMenuInit: (callback) => {
    ipcRenderer.on('avatar-menu-init', (_event, data) => callback(data));
  },
  sendAvatarMenuItemClick: (action) => ipcRenderer.send('avatar-menu-item-click', action),

  // ========== 账号历史（多账号记住密码）接口 ==========
  accounts: {
    list: () => ipcRenderer.invoke('accounts-list'),
    getPassword: (email) => ipcRenderer.invoke('accounts-get-password', { email }),
    save: (email, password, profile) =>
      ipcRenderer.invoke('accounts-save', { email, password, profile }),
    remove: (email) => ipcRenderer.invoke('accounts-remove', { email }),
    clear: () => ipcRenderer.invoke('accounts-clear'),
  },
});
