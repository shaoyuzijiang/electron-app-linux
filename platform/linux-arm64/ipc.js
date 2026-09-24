'use strict';

const path = require('path');
const { dialog } = require('electron');

const MEETING_ID_PATTERN = /^\d{5,32}$/;

function normalizeError(error) {
  return error && error.message ? error.message : '操作失败';
}

function validateMeetingId(value) {
  const id = String(value || '').trim();
  if (!MEETING_ID_PATTERN.test(id)) throw new Error('会议 ID 格式无效');
  return id;
}

function validateJoinPayload(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const meetingCode = String(source.meetingCode || '').replace(/[\s-]/g, '');
  const displayName = source.displayName === undefined ? '' : source.displayName;
  const password = source.password === undefined ? '' : source.password;
  const cameraOn = source.cameraOn === undefined ? true : source.cameraOn === true;
  if (!/^\d{5,20}$/.test(meetingCode)) throw new Error('请输入有效的会议号');
  if (typeof displayName !== 'string' || Buffer.byteLength(displayName, 'utf8') > 128) throw new Error('显示名称不能超过 128 字节');
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 32) throw new Error('会议密码不能超过 32 字节');
  return { meetingCode, displayName, password, cameraOn };
}

function validateMeetingPayload(input, isCreate) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const subject = String(source.subject || '').trim();
  const start = Number(source.start_time);
  const end = Number(source.end_time);
  const password = source.password === undefined ? '' : String(source.password);
  const muteType = Number(source.settings && source.settings.mute_enable_type_join);
  if (!subject || Buffer.byteLength(subject, 'utf8') > 512) throw new Error('会议主题不能为空且不能超过 512 字节');
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) throw new Error('会议时间无效');
  if (password && !/^\d{4,6}$/.test(password)) throw new Error('会议密码必须是 4–6 位数字');
  const payload = {
    subject,
    start_time: String(start),
    end_time: String(end),
    instanceid: 10,
    settings: { mute_enable_type_join: [0, 1, 2].includes(muteType) ? muteType : 2 },
  };
  if (isCreate) payload.type = 0;
  if (password) payload.password = password;
  return payload;
}

function registerLinuxIpc({ ipcMain, app, api, adapter, tokenStore, appSettings, httpClient, getMainWindow, showPage, getValidAccessToken, beginAuthOperation, invalidateAuth, isAuthOperationCurrent, refreshMeetingList, stopMeetingPolling, appRoot, handleScheme, getPendingSchemeUrl, consumePendingSchemeUrl }) {
  const required = { ipcMain, app, api, adapter, tokenStore, appSettings, httpClient, getMainWindow, showPage, getValidAccessToken, beginAuthOperation, invalidateAuth, isAuthOperationCurrent, refreshMeetingList, stopMeetingPolling, appRoot, handleScheme, getPendingSchemeUrl, consumePendingSchemeUrl };
  for (const [name, value] of Object.entries(required)) if (!value) throw new TypeError(`Linux IPC 缺少依赖：${name}`);

  const allowedPages = new Set(['login.html', 'index.html', 'meeting-settings.html'].map((file) => new URL(`file://${path.join(appRoot, 'renderer', file)}`).href));
  function trusted(event) {
    const win = getMainWindow();
    const frame = event.senderFrame;
    if (!win || win.isDestroyed() || event.sender !== win.webContents || !frame || frame !== event.sender.mainFrame || !allowedPages.has(frame.url)) {
      throw new Error('拒绝未授权的 IPC 调用');
    }
  }

  async function sdkAction(event, action) {
    trusted(event);
    try {
      await adapter.ensureLoggedIn(getValidAccessToken);
      await action();
      return { success: true };
    } catch (error) { return { success: false, message: normalizeError(error) }; }
  }

  ipcMain.handle('login', async (event, payload = {}) => {
    trusted(event);
    const email = typeof payload.email === 'string' ? payload.email.trim() : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (!email || email.length > 254 || !password || password.length > 256) return { success: false, message: '请输入有效的账号和密码' };
    const generation = beginAuthOperation();
    stopMeetingPolling();
    tokenStore.clearTokens();
    try {
      const tokens = await api.login(email, password, { clientVersion: app.getVersion(), clientType: 'linux', clientOs: `Kylin Linux ${process.arch}` });
      if (!isAuthOperationCurrent(generation)) throw new Error('登录操作已取消');
      tokenStore.saveTokens(tokens);
      const profile = await api.getProfile(tokens.accessToken);
      if (!isAuthOperationCurrent(generation)) throw new Error('登录操作已取消');
      await adapter.activateSession(false);
      adapter.ensureLoggedIn(getValidAccessToken).catch((error) => console.error('[SDK] 登录失败:', error.message));
      return { success: true, profile };
    } catch (error) {
      if (isAuthOperationCurrent(generation)) {
        tokenStore.clearTokens();
        adapter.cancelSession().catch(() => {});
      }
      return { success: false, message: normalizeError(error) };
    }
  });

  ipcMain.on('login-success', (event) => {
    try {
      trusted(event);
      if (tokenStore.getTokens()) showPage('main');
    } catch (error) { console.warn('[IPC]', error.message); }
  });

  ipcMain.handle('get-profile', async (event) => {
    trusted(event);
    try { return { success: true, profile: await api.getProfile(await getValidAccessToken()) }; }
    catch (error) { return { success: false, message: normalizeError(error) }; }
  });
  ipcMain.handle('logout', async (event) => {
    trusted(event);
    invalidateAuth();
    stopMeetingPolling();
    const tokens = tokenStore.getTokens();
    tokenStore.clearTokens();
    showPage('login');
    adapter.cancelSession().catch(() => {});
    if (tokens && tokens.accessToken) api.logout(tokens.accessToken, tokens.refreshToken).catch(() => {});
    return { success: true };
  });

  // Linux 版不保存账号或密码，避免不同麒麟桌面环境缺少安全密钥环时落到明文存储。
  // 仍返回正常的 IPC 结果，避免共享登录页的“记住密码”流程阻断登录跳转。
  ipcMain.handle('accounts-list', (event) => { trusted(event); return { success: true, data: [] }; });
  ipcMain.handle('accounts-get-password', (event) => { trusted(event); return { success: false, message: 'Linux 版不保存登录密码' }; });
  ipcMain.handle('accounts-save', (event) => { trusted(event); return { success: true, persisted: false }; });
  ipcMain.handle('accounts-remove', (event) => { trusted(event); return { success: true }; });
  ipcMain.handle('accounts-clear', (event) => { trusted(event); return { success: true }; });

  ipcMain.handle('get-server-url', (event) => { trusted(event); return { success: true, baseUrl: httpClient.getBaseUrl() }; });
  ipcMain.handle('set-server-url', async (event, { url } = {}) => {
    trusted(event);
    if (tokenStore.getTokens() || adapter.getStatus().initialized) return { success: false, message: '请退出登录后再切换服务端' };
    const result = await appSettings.setBaseUrl(url);
    if (result.success) httpClient.updateBaseUrl(result.baseUrl);
    return result;
  });
  ipcMain.handle('reset-server-url', (event) => {
    trusted(event);
    if (tokenStore.getTokens() || adapter.getStatus().initialized) return { success: false, message: '请退出登录后再恢复默认服务端' };
    const result = appSettings.resetBaseUrl();
    if (result.success) httpClient.updateBaseUrl(result.baseUrl);
    return result;
  });

  ipcMain.handle('get-meeting-list', async (event, options = {}) => {
    trusted(event);
    try {
      const safe = { instanceid: 10, is_show_all_sub_meetings: options.is_show_all_sub_meetings === '0' ? '0' : '1' };
      if (Number.isSafeInteger(Number(options.pos)) && Number(options.pos) >= 0) safe.pos = Number(options.pos);
      if (Number.isSafeInteger(Number(options.cursory)) && Number(options.cursory) >= 0) safe.cursory = Number(options.cursory);
      return { success: true, data: await api.getMeetingList(await getValidAccessToken(), safe) };
    } catch (error) { return { success: false, message: normalizeError(error) }; }
  });
  ipcMain.handle('create-meeting', async (event, meeting) => {
    trusted(event);
    try { return { success: true, data: await api.createMeeting(await getValidAccessToken(), validateMeetingPayload(meeting, true)) }; }
    catch (error) { return { success: false, message: normalizeError(error) }; }
  });
  ipcMain.handle('update-meeting', async (event, { meetingId, updates } = {}) => {
    trusted(event);
    try { return { success: true, data: await api.updateMeeting(await getValidAccessToken(), validateMeetingId(meetingId), validateMeetingPayload(updates, false)) }; }
    catch (error) { return { success: false, message: normalizeError(error) }; }
  });
  ipcMain.handle('cancel-meeting', async (event, { meetingId } = {}) => {
    trusted(event);
    try { return { success: true, data: await api.cancelMeeting(await getValidAccessToken(), validateMeetingId(meetingId), { reason_code: 1 }) }; }
    catch (error) { return { success: false, message: normalizeError(error) }; }
  });

  ipcMain.handle('get-sdk-status', (event) => { trusted(event); return adapter.getStatus(); });
  ipcMain.handle('get-sdk-capabilities', (event) => { trusted(event); return adapter.capabilities; });
  ipcMain.handle('wait-sdk-login', async (event) => sdkAction(event, () => Promise.resolve()));
  ipcMain.handle('join-meeting', async (event, payload = {}) => {
    try { return await sdkAction(event, () => adapter.joinMeeting(validateJoinPayload(payload))); }
    catch (error) { return { success: false, message: normalizeError(error) }; }
  });
  ipcMain.handle('quick-meeting', (event) => sdkAction(event, () => adapter.quickMeeting()));
  ipcMain.handle('leave-meeting', (event) => sdkAction(event, () => adapter.leaveMeeting()));
  ipcMain.handle('show-join-meeting-view', (event) => sdkAction(event, () => adapter.openView('join')));
  ipcMain.handle('show-schedule-meeting-view', (event) => sdkAction(event, () => adapter.openView('schedule')));
  ipcMain.handle('show-meeting-setting-view', (event) => sdkAction(event, () => adapter.openView('settings')));
  ipcMain.handle('show-historical-meeting-view', (event) => sdkAction(event, () => adapter.openView('history')));
  ipcMain.handle('show-meeting-detail-view', (event, { meetingId, subMeetingId = '' } = {}) => sdkAction(event, () => adapter.openView('detail', { meetingId: validateMeetingId(meetingId), subMeetingId: String(subMeetingId).slice(0, 64) })));
  ipcMain.handle('show-upload-logs-view', (event) => sdkAction(event, () => adapter.openView('uploadLogs')));

  // JSON 入会与响铃邀请：SDK 3.26 支持；运行时若 addon 缺失则优雅返回不支持。
  ipcMain.handle('join-meeting-by-json', (event, { meetingJson } = {}) => sdkAction(event, async () => {
    const json = String(meetingJson || '');
    if (!json) throw new Error('会议参数无效');
    await adapter.joinMeetingByJson(json);
  }));
  ipcMain.handle('parse-meeting-url', (event, { url } = {}) => {
    trusted(event);
    return adapter.parseMeetingUrl(String(url || ''));
  });
  ipcMain.handle('enable-ring-invitation-view', (event, { enable } = {}) => sdkAction(event, async () => {
    const code = adapter.requireMethod('EnableRingInvitationView')(enable !== false);
    if (code !== undefined && Number(code) !== 0) throw new Error(`EnableRingInvitationView 调用失败：${code}`);
  }));
  ipcMain.handle('handle-ring-invitation', (event, { accept, inviteId } = {}) => sdkAction(event, async () => {
    const code = adapter.requireMethod('HandleRingInvitation')(accept !== false, String(inviteId || ''));
    if (code !== undefined && Number(code) !== 0) throw new Error(`HandleRingInvitation 调用失败：${code}`);
  }));

  ipcMain.handle('set-proxy-info', (event, { proxyInfo } = {}) => sdkAction(event, () => {
    const code = adapter.requireMethod('SetProxyInfo')(String(proxyInfo || ''));
    if (code !== undefined && Number(code) !== 0) throw new Error(`SetProxyInfo 调用失败：${code}`);
  }));
  ipcMain.handle('get-proxy-info', (event) => {
    trusted(event);
    try { return { success: true, data: adapter.requireMethod('GetProxyInfo')() }; }
    catch (error) { return { success: false, message: normalizeError(error) }; }
  });

  ipcMain.handle('open-external', async (event, { url } = {}) => {
    trusted(event);
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('拒绝打开非 http(s) 链接');
    await shell.openExternal(url);
    return { success: true };
  });

  // Linux 无 Mac/Windows 的头像悬浮子窗口：头像点击弹出原生菜单，
  // 动作复用共享 Renderer 已监听的 avatar-menu-action 事件。
  ipcMain.handle('avatar-menu-toggle', async (event) => {
    trusted(event);
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { success: false, message: '主窗口不可用' };
    const { response } = await dialog.showMessageBox(win, {
      type: 'none',
      buttons: ['退出登录', '上传日志', '修改密码', '取消'],
      defaultId: 3,
      cancelId: 3,
      title: '账号',
      message: '账号操作',
    });
    const actions = ['logout', 'upload-logs', 'change-password'];
    const action = actions[response];
    if (!action) return { success: true };
    if (action === 'upload-logs') return sdkAction(event, () => adapter.openView('uploadLogs'));
    win.webContents.send('avatar-menu-action', action);
    return { success: true };
  });

  // ========== URL Scheme 唤起入会 ==========
  ipcMain.handle('handle-scheme', async (event, { url } = {}) => {
    trusted(event);
    try {
      await handleScheme(String(url || ''));
      return { success: true };
    } catch (error) { return { success: false, message: normalizeError(error) }; }
  });
  ipcMain.handle('get-pending-scheme-url', (event) => { trusted(event); return getPendingSchemeUrl(); });
  ipcMain.handle('consume-pending-scheme-url', (event) => { trusted(event); return consumePendingSchemeUrl(); });

  return { trusted };
}

module.exports = { registerLinuxIpc, validateJoinPayload, validateMeetingPayload, validateMeetingId };
