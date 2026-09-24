'use strict';

const fs = require('fs');
const path = require('path');
const userPicker = require('../../sdk_mgmt/user-picker');

// Linux 后端能力 IPC：IM / 日程 / 通讯录 / 修改密码。
// 全部走自建后端 HTTP/WS，零 SDK 依赖；通道名与 Mac/Windows 完全一致，
// 共享 Renderer（im.js / calendar.js / contacts.js / user-picker.html）无需任何改动。

function registerBackendHandlers({ ipcMain, shell, app, api, logger, getMainWindow, getValidAccessToken }) {
  const required = { ipcMain, shell, app, api, logger, getMainWindow, getValidAccessToken };
  for (const [name, value] of Object.entries(required)) {
    if (!value) throw new TypeError(`registerBackendHandlers 缺少依赖：${name}`);
  }

  const CACHE_DIR = path.join(app.getPath('userData'), 'cache', 'uploads');
  function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  function getCacheFilename(serverPath) {
    return path.basename(String(serverPath || '')) || null;
  }
  function getCachePath(serverPath) {
    const name = getCacheFilename(serverPath);
    if (!name) return null;
    const cachePath = path.join(CACHE_DIR, name);
    return fs.existsSync(cachePath) ? cachePath : null;
  }

  function wrap(handler) {
    return async (...args) => {
      try {
        return await handler(...args);
      } catch (err) {
        if (err.message === '未登录') return { success: false, message: '未登录，请重新登录' };
        return { success: false, message: err.message };
      }
    };
  }

  function withToken(handler) {
    return wrap(async (_event, payload) => {
      const accessToken = await getValidAccessToken();
      return handler(accessToken, payload);
    });
  }

  // ========== 通用 ==========
  ipcMain.handle('change-password', withToken((accessToken, { oldPassword, newPassword } = {}) =>
    api.changePassword(accessToken, oldPassword, newPassword).then((data) => ({ success: true, data }))));

  ipcMain.on('renderer-log', (_event, { level, message } = {}) => {
    if (logger && typeof logger.writeLog === 'function') logger.writeLog(level, ['[Renderer]', message]);
  });

  // ========== 选人组件（Electron 纯窗口，无 SDK 依赖） ==========
  userPicker.init({ wemeetSdk: null, getMainWindow });
  ipcMain.handle('im-open-add-member-picker', (_event, { conversationId, existingMemberIds } = {}) => {
    try {
      userPicker.openUserPickerWindow('add_group_members', JSON.stringify({ conversationId, existingMemberIds: existingMemberIds || [] }));
      return { success: true };
    } catch (err) { return { success: false, message: err.message }; }
  });
  ipcMain.handle('im-open-new-chat-picker', (_event, { currentUserId } = {}) => {
    try {
      userPicker.openUserPickerWindow('new_conversation', JSON.stringify({ currentUserId: currentUserId || '' }));
      return { success: true };
    } catch (err) { return { success: false, message: err.message }; }
  });
  ipcMain.handle('close-user-picker-window', () => { userPicker.closeUserPickerWindow(); return { success: true }; });
  ipcMain.handle('get-meeting-window-info', () => ({ success: true, data: userPicker.getMeetingWindowInfo() }));
  ipcMain.on('im-add-member-done', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('im-add-member-done');
  });
  ipcMain.on('im-new-chat-created', (_event, conversationId) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('im-new-chat-created', conversationId);
  });

  // ========== IM：连接辅助 ==========
  ipcMain.handle('get-access-token', wrap(async () => ({ success: true, accessToken: await getValidAccessToken() })));
  ipcMain.handle('get-ws-url', () => ({ success: true, url: api.getWsUrl() }));
  ipcMain.handle('get-file-url', (_event, { path: serverPath } = {}) => ({ success: true, url: api.getFileUrl(serverPath) }));

  const MIME_MAP = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
  async function downloadFile(serverPath) {
    const accessToken = await getValidAccessToken();
    const url = api.getFileUrl(serverPath);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers['content-type'] || '' };
  }

  ipcMain.handle('fetch-image-data', wrap(async (_event, { path: serverPath } = {}) => {
    ensureCacheDir();
    const cachePath = getCachePath(serverPath);
    if (cachePath) {
      const buffer = fs.readFileSync(cachePath);
      const contentType = MIME_MAP[path.extname(cachePath).toLowerCase()] || 'image/png';
      return { success: true, data: `data:${contentType};base64,${buffer.toString('base64')}` };
    }
    const { buffer, contentType } = await downloadFile(serverPath);
    const name = getCacheFilename(serverPath);
    if (name) fs.writeFileSync(path.join(CACHE_DIR, name), buffer);
    return { success: true, data: `data:${contentType || 'image/png'};base64,${buffer.toString('base64')}` };
  }));

  ipcMain.handle('open-cached-file', wrap(async (_event, { path: serverPath, filename } = {}) => {
    ensureCacheDir();
    let cachePath = getCachePath(serverPath);
    if (!cachePath) {
      const { buffer } = await downloadFile(serverPath);
      const name = getCacheFilename(serverPath);
      if (name) {
        cachePath = path.join(CACHE_DIR, name);
        fs.writeFileSync(cachePath, buffer);
      }
    }
    if (cachePath) {
      shell.openPath(cachePath);
      return { success: true };
    }
    return { success: false, message: '无法获取文件' };
  }));

  // ========== IM：会话与消息 ==========
  ipcMain.handle('im-get-conversations', withToken((accessToken) => api.getConversations(accessToken).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-create-conversation', withToken((accessToken, { type, name, memberIds } = {}) =>
    api.createConversation(accessToken, { type, name, memberIds }).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-get-conversation-detail', withToken((accessToken, { conversationId } = {}) =>
    api.getConversationDetail(accessToken, conversationId).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-get-messages', withToken((accessToken, { conversationId, before, after, limit } = {}) =>
    api.getMessages(accessToken, conversationId, { before, after, limit }).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-send-message', withToken((accessToken, { conversationId, type, content } = {}) =>
    api.sendMessageHttp(accessToken, conversationId, { type, content }).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-mark-read', withToken(async (accessToken, { conversationId } = {}) => {
    await api.markConversationRead(accessToken, conversationId);
    return { success: true };
  }));
  ipcMain.handle('im-get-members', withToken((accessToken, { conversationId } = {}) =>
    api.getConversationMembers(accessToken, conversationId).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-add-member', withToken((accessToken, { conversationId, userId } = {}) =>
    api.addConversationMember(accessToken, conversationId, userId).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-remove-member', withToken((accessToken, { conversationId, userId } = {}) =>
    api.removeConversationMember(accessToken, conversationId, userId).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-update-conversation', withToken((accessToken, { conversationId, name, avatar } = {}) => {
    const params = {};
    if (name !== undefined && name !== null) params.name = name;
    if (avatar !== undefined && avatar !== null) params.avatar = avatar;
    return api.updateConversation(accessToken, conversationId, params).then((data) => ({ success: true, data }));
  }));
  ipcMain.handle('im-dissolve-conversation', withToken((accessToken, { conversationId } = {}) =>
    api.dissolveConversation(accessToken, conversationId).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-transfer-ownership', withToken((accessToken, { conversationId, userId } = {}) =>
    api.transferOwnership(accessToken, conversationId, userId).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-set-member-role', withToken((accessToken, { conversationId, userId, role } = {}) =>
    api.setMemberRole(accessToken, conversationId, userId, role).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-get-unread-count', withToken((accessToken) => api.getUnreadCount(accessToken).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-get-online-users', withToken((accessToken) => api.getOnlineUsers(accessToken).then((data) => ({ success: true, data }))));
  ipcMain.handle('im-upload-file', withToken(async (accessToken, { filePath, filename, mimetype, fileData } = {}) => {
    let fileBuffer;
    if (fileData && fileData.byteLength) {
      fileBuffer = Buffer.from(fileData);
    } else {
      if (!filePath) throw new Error('未提供文件路径或数据');
      fileBuffer = fs.readFileSync(filePath);
    }
    const data = await api.uploadFile(accessToken, fileBuffer, filename, mimetype);
    return { success: true, data };
  }));
  ipcMain.handle('im-search-users', withToken((accessToken, { keyword } = {}) =>
    api.searchUsers(accessToken, keyword).then((data) => ({ success: true, data }))));

  // ========== 通讯录 ==========
  ipcMain.handle('get-department-tree', withToken((accessToken) => api.getDepartmentTree(accessToken).then((data) => ({ success: true, data }))));
  ipcMain.handle('get-department-users', withToken((accessToken, { departmentId, recursive, page, pageSize } = {}) =>
    api.getDepartmentUsers(accessToken, departmentId, { recursive, page, pageSize }).then((data) => ({ success: true, data }))));
  ipcMain.handle('search-users', withToken((accessToken, { query } = {}) =>
    api.searchUsers(accessToken, query).then((data) => ({ success: true, data }))));

  // ========== 日程 ==========
  ipcMain.handle('calendar-create-event', withToken((accessToken, params) => api.createEvent(accessToken, params).then((data) => ({ success: true, data }))));
  ipcMain.handle('calendar-get-events', withToken((accessToken, options = {}) => api.getEvents(accessToken, options).then((data) => ({ success: true, data }))));
  ipcMain.handle('calendar-get-event-detail', withToken((accessToken, { eventId } = {}) => api.getEventDetail(accessToken, eventId).then((data) => ({ success: true, data }))));
  ipcMain.handle('calendar-update-event', withToken((accessToken, { eventId, params } = {}) => api.updateEvent(accessToken, eventId, params).then((data) => ({ success: true, data }))));
  ipcMain.handle('calendar-cancel-event', withToken((accessToken, { eventId } = {}) => api.cancelEvent(accessToken, eventId).then((data) => ({ success: true, data }))));
  ipcMain.handle('calendar-add-participant', withToken((accessToken, { eventId, userId } = {}) => api.addEventParticipant(accessToken, eventId, userId).then((data) => ({ success: true, data }))));
  ipcMain.handle('calendar-remove-participant', withToken((accessToken, { eventId, userId } = {}) => api.removeEventParticipant(accessToken, eventId, userId).then((data) => ({ success: true, data }))));
  ipcMain.handle('calendar-get-participants', withToken((accessToken, { eventId } = {}) => api.getEventParticipants(accessToken, eventId).then((data) => ({ success: true, data }))));
  ipcMain.handle('calendar-get-freebusy', withToken((accessToken, params) => api.getFreeBusy(accessToken, params).then((data) => ({ success: true, data }))));

  return { CACHE_DIR, userPicker };
}

module.exports = { registerBackendHandlers };
