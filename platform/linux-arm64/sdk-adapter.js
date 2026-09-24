'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const capabilities = require('./capabilities');

const CALLBACK_TIMEOUT_MS = 30000;
const SHUTDOWN_TIMEOUT_MS = 10000;

function validateSsoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.length > 8192) throw new Error('服务端返回的 SSO URL 无效');
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('服务端返回的 SSO URL 格式无效'); }
  const hostname = parsed.hostname.toLowerCase();
  const trustedMeetingCidp = (hostname === 'meeting.qq.com' || hostname.endsWith('.meeting.qq.com')) && parsed.pathname.startsWith('/cidp/');
  const trustedTencentOauth = hostname === 'oauth2.account.tencent.com' && parsed.pathname.startsWith('/v1/sso/jwtp/') && parsed.pathname.endsWith('/kit/meeting');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash || (!trustedMeetingCidp && !trustedTencentOauth)) {
    throw new Error(`服务端返回了不受信任的腾讯会议 SSO URL：${parsed.protocol}//${hostname}${parsed.pathname}`);
  }
  return parsed.toString();
}

function createLinuxSdkAdapter({ app, api, projectRoot, getSdkRoot, getAppIconPath, requireAddon, runtime = process } = {}) {
  if (!app || typeof app.getPath !== 'function' || typeof app.getName !== 'function') throw new TypeError('Linux SDK adapter 缺少 Electron app');
  if (!api || typeof api.getSdkToken !== 'function' || typeof api.getIdToken !== 'function') throw new TypeError('Linux SDK adapter 缺少后端 API');

  const events = new EventEmitter();
  const root = projectRoot || path.resolve(__dirname, '..', '..');
  const resolveSdkRoot = getSdkRoot || (() => {
    const installed = path.join(path.dirname(process.execPath), 'resources', 'wemeet-sdk', 'linux');
    return fs.existsSync(installed) ? installed : path.join(root, 'output', 'linux');
  });
  const resolveAppIcon = getAppIconPath || (() => {
    const installed = path.join(path.dirname(process.execPath), 'resources', 'app.png');
    return fs.existsSync(installed) ? installed : path.join(root, 'renderer', 'assets', 'app.png');
  });
  const loadAddon = requireAddon || ((target) => require(target));

  let addon = null;
  let loadError = null;
  let lastError = null;
  let initialized = false;
  let loggedIn = false;
  let inMeeting = false;
  let sessionActive = false;
  let sessionGeneration = 0;
  let accessTokenProvider = null;
  let rendererSender = null;
  let transition = Promise.resolve();
  let stateUncertain = false;
  let initializeFlight = null;
  let loginFlight = null;
  let refreshFlight = null;
  let pendingInitialize = null;
  let pendingLogin = null;
  let pendingShutdown = null;
  let pendingMeeting = null;

  function status() {
    return {
      loaded: Boolean(addon), initialized, loggedIn, inMeeting,
      version: addon && typeof addon.GetSDKVersion === 'function' ? addon.GetSDKVersion() : null,
      error: lastError || (loadError && loadError.message) || null,
    };
  }

  function requireAccessToken() {
    if (typeof accessTokenProvider !== 'function') throw new Error('业务认证未配置');
    return accessTokenProvider();
  }

  function callbackSucceeded(callback) {
    return callback.code === undefined || Number(callback.code) === 0;
  }

  function settle(slot, pending, success, message) {
    if (!pending) return;
    clearTimeout(pending.timer);
    if (slot === 'initialize' && pendingInitialize === pending) pendingInitialize = null;
    if (slot === 'login' && pendingLogin === pending) pendingLogin = null;
    if (slot === 'shutdown' && pendingShutdown === pending) pendingShutdown = null;
    if (slot === 'meeting' && pendingMeeting === pending) pendingMeeting = null;
    success ? pending.resolve(true) : pending.reject(new Error(message || 'SDK 操作失败'));
  }

  function cancelPending(message) {
    settle('initialize', pendingInitialize, false, message || 'SDK 操作已取消');
    settle('login', pendingLogin, false, message || 'SDK 操作已取消');
    settle('meeting', pendingMeeting, false, message || 'SDK 操作已取消');
  }

  function createWaiter(slot, label, generation, timeoutMs, metadata = {}) {
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, label, generation, ...metadata, timer: null };
      pending.timer = setTimeout(() => {
        if (slot === 'initialize' && pendingInitialize === pending) pendingInitialize = null;
        if (slot === 'login' && pendingLogin === pending) pendingLogin = null;
        if (slot === 'shutdown' && pendingShutdown === pending) {
          pendingShutdown = null;
          stateUncertain = true;
        }
        if (slot === 'meeting' && pendingMeeting === pending) pendingMeeting = null;
        lastError = `${label}等待回调超时`;
        reject(new Error(lastError));
      }, timeoutMs);
      if (slot === 'initialize') pendingInitialize = pending;
      if (slot === 'login') pendingLogin = pending;
      if (slot === 'shutdown') pendingShutdown = pending;
      if (slot === 'meeting') pendingMeeting = pending;
    });
  }

  function handleCallback(raw) {
    if (rendererSender) rendererSender('sdk-callback', raw);
    let callback;
    try { callback = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch {
      lastError = '收到无法解析的 SDK 回调';
      return;
    }

    const success = callbackSucceeded(callback);
    if (callback.func === 'OnSDKInitializeResult') {
      const pending = pendingInitialize;
      if (pending && pending.generation === sessionGeneration && sessionActive) {
        initialized = success;
        lastError = success ? null : (callback.msg || 'SDK 初始化失败');
        settle('initialize', pending, success, lastError);
      }
    } else if (callback.func === 'OnLogin') {
      const pending = pendingLogin;
      if (!pending || pending.generation !== sessionGeneration || !sessionActive) {
        try { if (addon && typeof addon.Logout === 'function') addon.Logout(); } catch {}
      } else {
        loggedIn = success;
        lastError = success ? null : (callback.msg || 'SDK 登录失败');
        settle('login', pending, success, lastError);
      }
    } else if (callback.func === 'OnJoinMeeting' || callback.func === 'OnLeaveMeeting') {
      if (success && sessionActive) inMeeting = callback.func === 'OnJoinMeeting';
      const pending = pendingMeeting;
      if (pending && pending.callbackName === callback.func && pending.generation === sessionGeneration && sessionActive) {
        settle('meeting', pending, success, callback.msg || `${pending.label}失败`);
      }
    } else if (callback.func === 'OnLogout') {
      if (sessionActive && !pendingLogin) loggedIn = false;
      inMeeting = false;
    } else if (callback.func === 'OnSDKUninitializeResult') {
      const pending = pendingShutdown;
      if (pending && pending.generation === sessionGeneration && !sessionActive) {
        initialized = false;
        loggedIn = false;
        inMeeting = false;
        stateUncertain = !success;
        settle('shutdown', pending, success, callback.msg || 'SDK 反初始化失败');
      }
    } else if (callback.func === 'OnSDKError' || callback.func === 'OnResetSDKState') {
      initialized = callback.func === 'OnResetSDKState' && callback.param && callback.param.instance_released !== true ? initialized : false;
      loggedIn = false;
      inMeeting = false;
      lastError = callback.msg || `SDK 状态异常：${callback.code || 'unknown'}`;
      cancelPending(lastError);
    } else if (callback.func === 'OnSDKTokenExpired') {
      refreshSdkToken().catch((error) => {
        lastError = error.message;
        loggedIn = false;
        inMeeting = false;
      });
    }
    events.emit('callback', { func: callback.func, success, raw, callback });
  }

  async function load() {
    if (addon || loadError) return addon;
    if (process.env.WEMEET_UI_ONLY === '1') {
      loadError = new Error('当前为 UI 开发模式，未加载 Linux SDK');
      return null;
    }
    if (runtime.platform !== 'linux' || runtime.arch !== 'arm64') {
      loadError = new Error(`仅支持 Linux ARM64，当前为 ${runtime.platform}/${runtime.arch}`);
      return null;
    }
    try {
      addon = loadAddon(path.join(resolveSdkRoot(), 'wemeet_electron_sdk.node'));
      const required = ['AddJsCallback', 'DisposeJsCallback', 'GetSDKVersion', 'InitWemeetSDK', 'Login', 'Logout', 'RefreshSDKToken', 'JoinMeeting', 'QuickMeeting', 'LeaveMeeting', 'ForceQuit'];
      const missing = required.filter((name) => typeof addon[name] !== 'function');
      if (missing.length) throw new Error(`SDK addon 缺少接口：${missing.join(', ')}`);
      addon.AddJsCallback(handleCallback);
      return addon;
    } catch (error) {
      loadError = new Error(`加载 Linux SDK addon 失败：${error.message}`);
      lastError = loadError.message;
      return null;
    }
  }

  async function deactivate() {
    sessionGeneration += 1;
    sessionActive = false;
    refreshFlight = null;
    const nativeActive = initialized || loggedIn || pendingInitialize || pendingLogin || pendingMeeting;
    cancelPending('用户会话已结束');
    if (!addon || !nativeActive) {
      try { if (addon && typeof addon.DisposeJsCallback === 'function') addon.DisposeJsCallback(); } catch {}
      initialized = false;
      loggedIn = false;
      inMeeting = false;
      return true;
    }
    const waiter = createWaiter('shutdown', 'SDK 反初始化', sessionGeneration, SHUTDOWN_TIMEOUT_MS);
    try {
      const code = addon.ForceQuit();
      if (code !== undefined && Number(code) !== 0) settle('shutdown', pendingShutdown, false, `SDK 退出调用失败：${code}`);
    } catch (error) {
      settle('shutdown', pendingShutdown, false, error.message);
    }
    await waiter;
    if (typeof addon.DisposeJsCallback === 'function') addon.DisposeJsCallback();
    initialized = false;
    loggedIn = false;
    inMeeting = false;
    stateUncertain = false;
    return true;
  }

  function cancelSession() {
    const operation = transition.then(() => {
      if (stateUncertain) throw new Error('SDK 状态不确定，请重启应用');
      return deactivate();
    }).catch((error) => {
      stateUncertain = true;
      throw error;
    });
    transition = operation.catch(() => {});
    return operation;
  }

  async function activateSession(reset = true) {
    if (stateUncertain) throw new Error('SDK 状态不确定，请重启应用');
    if (reset) transition = transition.then(deactivate);
    await transition;
    if (sessionActive && !reset) return sessionGeneration;
    if (addon && typeof addon.AddJsCallback === 'function') addon.AddJsCallback(handleCallback);
    sessionGeneration += 1;
    sessionActive = true;
    lastError = null;
    return sessionGeneration;
  }

  function getRuntimeDiagnostics() {
    const root = resolveSdkRoot();
    const files = ['wemeet_electron_sdk.node', 'libwemeetsdk.so', 'libwemeet_base.so', 'Release/tmsdkapp', 'Release/QtWebEngineProcess'];
    return {
      sdkRoot: root,
      files: Object.fromEntries(files.map((file) => {
        const target = path.join(root, file);
        try { return [file, { exists: fs.existsSync(target), executable: fs.existsSync(target) && Boolean(fs.statSync(target).mode & 0o111) }]; }
        catch { return [file, { exists: false, executable: false }]; }
      })),
      graphics: Object.fromEntries(['LD_LIBRARY_PATH', 'QT_QPA_PLATFORM', 'EGL_PLATFORM', 'MESA_LOADER_DRIVER_OVERRIDE', 'LIBGL_ALWAYS_SOFTWARE', 'LIBGL_ALWAYS_INDIRECT', 'LD_PRELOAD'].map((key) => [key, process.env[key] || '<empty>'])),
    };
  }

  async function initialize() {
    if (!sessionActive) throw new Error('用户会话未激活');
    if (initialized) return true;
    const generation = sessionGeneration;
    if (initializeFlight && initializeFlight.generation === generation) return initializeFlight.promise;
    const flight = { generation, promise: null };
    flight.promise = (async () => {
      const sdk = addon || await load();
      if (!sdk) throw loadError || new Error('SDK 未加载');
      const token = await api.getSdkToken(await requireAccessToken());
      if (!token || !token.sdkId || !token.sdkToken) throw new Error('服务端未返回 SDK Token');
      const waiter = createWaiter('initialize', 'SDK 初始化', generation, CALLBACK_TIMEOUT_MS);
      if (process.env.WEMEET_SDK_DIAGNOSTICS === '1' || fs.existsSync(path.join(resolveSdkRoot(), 'Release', 'tmsdkapp'))) {
        console.log('[SDK] 初始化运行时诊断:', getRuntimeDiagnostics());
      }
      try {
        const code = sdk.InitWemeetSDK(String(token.sdkId), String(token.sdkToken), path.join(app.getPath('userData'), 'tm_sdk'), app.getName(), resolveAppIcon(), 'zh-cn', '');
        if (code !== undefined && Number(code) !== 0) settle('initialize', pendingInitialize, false, `SDK 初始化调用失败：${code}`);
      } catch (error) { settle('initialize', pendingInitialize, false, error.message); }
      return waiter;
    })().catch((error) => {
      if (generation === sessionGeneration) lastError = error.message;
      throw error;
    }).finally(() => { if (initializeFlight === flight) initializeFlight = null; });
    initializeFlight = flight;
    return flight.promise;
  }

  async function login(ssoUrl) {
    if (!sessionActive) throw new Error('用户会话未激活');
    if (loggedIn) return true;
    const generation = sessionGeneration;
    if (loginFlight && loginFlight.generation === generation) return loginFlight.promise;
    const flight = { generation, promise: null };
    flight.promise = (async () => {
      await initialize();
      const waiter = createWaiter('login', 'SDK 登录', generation, CALLBACK_TIMEOUT_MS);
      try {
        const code = addon.Login(validateSsoUrl(ssoUrl));
        if (code !== undefined && Number(code) !== 0) settle('login', pendingLogin, false, `SDK 登录调用失败：${code}`);
      } catch (error) { settle('login', pendingLogin, false, error.message); }
      return waiter;
    })().catch((error) => {
      if (generation === sessionGeneration) lastError = error.message;
      throw error;
    }).finally(() => { if (loginFlight === flight) loginFlight = null; });
    loginFlight = flight;
    return flight.promise;
  }

  async function ensureLoggedIn(getAccessToken) {
    await transition;
    if (!sessionActive) throw new Error('用户会话未激活');
    if (!accessTokenProvider && typeof getAccessToken === 'function') accessTokenProvider = getAccessToken;
    const accessToken = await requireAccessToken();
    if (loggedIn) return true;
    await initialize();
    const idToken = await api.getIdToken(accessToken);
    return login(idToken && idToken.ssoUrl);
  }

  async function refreshSdkToken() {
    if (refreshFlight) return refreshFlight;
    refreshFlight = (async () => {
      if (!sessionActive || !addon) throw new Error('SDK Token 无法刷新');
      const token = await api.getSdkToken(await requireAccessToken());
      if (!token || !token.sdkToken) throw new Error('服务端未返回 SDK Token');
      const code = addon.RefreshSDKToken(String(token.sdkToken));
      if (code !== undefined && Number(code) !== 0) throw new Error(`SDK Token 刷新失败：${code}`);
      return true;
    })().finally(() => { refreshFlight = null; });
    return refreshFlight;
  }

  function requireMethod(name) {
    if (!addon) throw loadError || new Error('SDK 未加载');
    if (typeof addon[name] !== 'function') throw new Error(`Linux SDK 3.26 不支持 ${name}`);
    return addon[name].bind(addon);
  }

  async function invokeMeeting(method, args, callbackName, label) {
    if (!sessionActive || !loggedIn) throw new Error('会议服务尚未登录');
    if (pendingMeeting) throw new Error('已有会议操作正在进行，请稍候');
    const waiter = createWaiter('meeting', label, sessionGeneration, CALLBACK_TIMEOUT_MS, { callbackName });
    try {
      const code = requireMethod(method)(...args);
      if (code !== undefined && Number(code) !== 0) settle('meeting', pendingMeeting, false, `${label}调用失败：${code}`);
    } catch (error) { settle('meeting', pendingMeeting, false, error.message); }
    return waiter;
  }

  return Object.freeze({
    events,
    capabilities,
    load,
    getStatus: status,
    setAccessTokenProvider: (provider) => { accessTokenProvider = typeof provider === 'function' ? provider : null; },
    setRendererSender: (sender) => { rendererSender = typeof sender === 'function' ? sender : null; },
    activateSession,
    cancelSession,
    ensureLoggedIn,
    isSessionActive: () => sessionActive,
    // SDK 3.26 JoinMeeting 参数顺序：
    // [0]会议号 [1]显示名 [2]密码 [3]邀请链接 [4]mic_on [5]camera_on [6]speaker_on [7]face_beauty [8]标题
    // camera_on 是显式参数，会覆盖 SDK 设置页“入会开启视频”；默认开视频，与设置页预期一致。
    joinMeeting: ({ meetingCode, displayName = '', password = '', cameraOn = true }) =>
      invokeMeeting('JoinMeeting', [String(meetingCode), String(displayName), String(password), '', true, Boolean(cameraOn), true, false, ''], 'OnJoinMeeting', '加入会议'),
    joinMeetingByJson: (meetingJson) => invokeMeeting('JoinMeetingByJSON', [String(meetingJson)], 'OnJoinMeeting', '加入会议'),
    quickMeeting: () => invokeMeeting('QuickMeeting', [], 'OnJoinMeeting', '快速会议'),
    leaveMeeting: () => invokeMeeting('LeaveMeeting', [false], 'OnLeaveMeeting', '离开会议'),
    openView: async (view, detail = {}) => {
      const methods = {
        join: ['ShowJoinMeetingView', []],
        schedule: ['ShowScheduleMeetingView', [false]],
        settings: ['ShowMeetingSettingView', []],
        history: ['ShowHistoricalMeetingView', []],
        detail: ['ShowMeetingDetailView', [String(detail.meetingId || ''), String(detail.subMeetingId || '')]],
        uploadLogs: ['ShowUploadLogsView', []],
      };
      const target = methods[view];
      if (!target || !capabilities[`view.${view}`]) throw new Error(`当前 Linux SDK 不支持 ${view}`);
      await ensureLoggedIn();
      const code = requireMethod(target[0])(...target[1]);
      if (code !== undefined && Number(code) !== 0) throw new Error(`${target[0]} 调用失败：${code}`);
      return true;
    },
  });
}

module.exports = { createLinuxSdkAdapter, validateSsoUrl };
