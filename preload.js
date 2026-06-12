const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 原有接口
  login: (email, password) => ipcRenderer.invoke('login', { email, password }),
  loginSuccess: () => ipcRenderer.send('login-success'),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  logout: () => ipcRenderer.invoke('logout'),
  changePassword: (oldPassword, newPassword) => ipcRenderer.invoke('change-password', { oldPassword, newPassword }),
  createMeeting: (meetingData) => ipcRenderer.invoke('create-meeting', meetingData),
  getMeetingList: (options) => ipcRenderer.invoke('get-meeting-list', options),
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
});
