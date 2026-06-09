const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 原有接口
  login: (username, password) => ipcRenderer.invoke('login', { username, password }),
  loginSuccess: () => ipcRenderer.send('login-success'),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  logout: () => ipcRenderer.invoke('logout'),
  changePassword: (oldPassword, newPassword) => ipcRenderer.invoke('change-password', { oldPassword, newPassword }),
  getSdkToken: () => ipcRenderer.invoke('get-sdk-token'),
  getIdToken: () => ipcRenderer.invoke('get-id-token'),
  fetchIdToken: () => ipcRenderer.invoke('fetch-id-token'),

  // 腾讯会议 SDK 接口
  getSdkStatus: () => ipcRenderer.invoke('get-sdk-status'),
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

  // 监听 SDK 回调
  onSdkCallback: (callback) => {
    ipcRenderer.on('sdk-callback', (_event, msg) => callback(msg));
  },
});
