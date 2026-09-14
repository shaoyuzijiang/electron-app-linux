'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = Object.freeze({
  getSnapshot: () => ipcRenderer.invoke('demo:get-snapshot'),
  initialize: (input) => ipcRenderer.invoke('demo:initialize', input),
  login: (input) => ipcRenderer.invoke('demo:login', input),
  joinMeeting: (input) => ipcRenderer.invoke('demo:join-meeting', input),
  leaveMeeting: () => ipcRenderer.invoke('demo:leave-meeting'),
  logout: () => ipcRenderer.invoke('demo:logout'),
  uninitialize: () => ipcRenderer.invoke('demo:uninitialize'),
  onUpdate: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('监听器必须是函数');
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('demo:update', wrapped);
    return () => ipcRenderer.removeListener('demo:update', wrapped);
  }
});

contextBridge.exposeInMainWorld('meetingDemo', api);
