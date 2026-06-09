const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  login: (username, password) => ipcRenderer.invoke('login', { username, password }),
  loginSuccess: () => ipcRenderer.send('login-success'),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  logout: () => ipcRenderer.invoke('logout'),
  changePassword: (oldPassword, newPassword) => ipcRenderer.invoke('change-password', { oldPassword, newPassword }),
  getSdkToken: () => ipcRenderer.invoke('get-sdk-token'),
  getIdToken: () => ipcRenderer.invoke('get-id-token'),
  fetchIdToken: () => ipcRenderer.invoke('fetch-id-token'),
});
