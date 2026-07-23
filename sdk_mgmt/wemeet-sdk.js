const { app } = require('electron');
const path = require('path');
const EventEmitter = require('events');
const api = require('../backend_api/api');
const tokenStore = require('../utils/token-store');

// Windows 平台设置控制台为 UTF-8 编码，解决中文乱码
if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
  } catch {}
}

// 应用图标路径（打包后图标在 extraResources 或 asar 外部）
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'app.png')
  : path.join(__dirname, '..', 'app.png');

// URL Scheme 名称，用于唤起客户端
const SCHEME_NAME = 'wemeetsdk';

// 加载腾讯会议 SDK
let wemeetSdk = null;
let sdkInitialized = false;
let sdkLoggedIn = false;
let sdkInitResolve, sdkInitReject;
let sdkLoginResolve, sdkLoginReject;
let currentSdkLoginPromise = null;
let sdkInitPromise = null;
let sdkInitializing = false;
let sdkLoggingIn = false;
const MAX_RETRY = 3;

// 刷新令牌锁，防止并发刷新导致 refresh token 被复用
let refreshPromise = null;

// SDK 事件发射器，供外部模块监听 SDK 回调事件
const sdkEvents = new EventEmitter();

// mainWindow 获取函数（由 main.js 注入）
let _getMainWindow = null;

/**
 * 注入 mainWindow 获取函数，用于 SDK 回调转发到渲染进程
 * @param {Function} getMainWindow - 返回 mainWindow 引用的函数
 */
function initCallbackHandler(getMainWindow) {
  _getMainWindow = getMainWindow;
}

// 获取 SDK 资源根目录（兼容开发模式与打包后 extraResources）
function getSdkBasePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath);
  }
  return path.join(__dirname, '..');
}

/**
 * 加载 asar 外部的原生模块
 * 打包后 .node 文件位于 app.asar.unpacked 目录下，
 * require() 无法直接加载 asar 外的 .node 文件，
 * 需要将路径从 app.asar 转换为 app.asar.unpacked
 */
function requireNative(modulePath) {
  // 将相对路径转为绝对路径，确保能正确匹配 app.asar 字符串
  let absPath = path.resolve(modulePath);
  const possiblePaths = [absPath];

  // 打包后：app.asar -> app.asar.unpacked
  if (absPath.includes('app.asar')) {
    possiblePaths.push(absPath.replace('app.asar', 'app.asar.unpacked'));
  } else if (app.isPackaged) {
    // 打包后 __dirname 在 asar 内，但文件实际在 unpacked 目录
    // 从 resourcesPath 出发构建路径
    const unpackedBase = path.join(process.resourcesPath, 'app.asar.unpacked');
    const relativeToSdk = path.relative(path.join(__dirname, '..'), absPath);
    possiblePaths.push(path.join(unpackedBase, relativeToSdk));
  }

  for (const p of possiblePaths) {
    try {
      return require(p);
    } catch (e) {
      // 继续尝试下一个路径
    }
  }
  throw new Error(`无法加载原生模块: ${modulePath}（尝试过: ${possiblePaths.join(', ')}）`);
}

try {
  if (process.platform === 'darwin') {
    try {
      wemeetSdk = requireNative(path.join(__dirname, '..', 'output', 'mac', 'wemeet_electron_sdk.node'));
    } catch {
      const arch = process.arch;
      try {
        wemeetSdk = requireNative(path.join(__dirname, '..', 'output', 'mac', `wemeet_electron_sdk.${arch}.node`));
      } catch {
        console.error('无法加载腾讯会议 SDK 原生模块');
      }
    }
  } else if (process.platform === 'win32' && process.arch === 'x64') {
    const sdkDllDir = path.join(getSdkBasePath(), 'wemeet_sdk', 'win', 'x64');
    if (!process.env.PATH.includes(sdkDllDir)) {
      process.env.PATH = sdkDllDir + ';' + process.env.PATH;
    }
    wemeetSdk = requireNative(path.join(getSdkBasePath(), 'wemeet_sdk', 'win', 'x64', 'wemeet_electron_sdk.node'));
  } else if (process.platform === 'win32') {
    const sdkDllDir = path.join(getSdkBasePath(), 'wemeet_sdk', 'win', 'win32');
    if (!process.env.PATH.includes(sdkDllDir)) {
      process.env.PATH = sdkDllDir + ';' + process.env.PATH;
    }
    wemeetSdk = requireNative(path.join(getSdkBasePath(), 'wemeet_sdk', 'win', 'win32', 'wemeet_electron_sdk.node'));
  }
  console.log('腾讯会议 SDK 加载成功，版本:', wemeetSdk.GetSDKVersion());
} catch (err) {
  console.warn('腾讯会议 SDK 加载失败:', err.message);
  console.warn('会议相关功能将不可用，请先运行 npm run build 编译 SDK');
}

/**
 * 获取有效的 accessToken，如果已过期则自动刷新
 * 使用 Promise 锁确保同一时间只有一个刷新请求，避免并发刷新导致 refresh token 被复用
 */
async function getValidAccessToken() {
  const tokens = tokenStore.getTokens();
  if (!tokens) {
    throw new Error('未登录');
  }

  if (!tokenStore.isAccessTokenExpired()) {
    return tokens.accessToken;
  }

  // 如果已有刷新请求在进行中，复用该 Promise 避免并发刷新
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const newTokenData = await api.refreshToken(tokens.refreshToken);
      tokenStore.saveTokens(newTokenData);
      return newTokenData.accessToken;
    } catch (err) {
      // Refresh token 失效（被撤销或过期），清除凭据并跳转登录页
      console.error('刷新令牌失败:', err.message);
      tokenStore.clearTokens();
      tokenStore.clearMeetingTokens();

      // 通知主进程停止轮询，并跳转到登录页
      sdkEvents.emit('auth-expired');

      const mainWindow = _getMainWindow ? _getMainWindow() : null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'login.html'));
      }

      throw new Error('登录已过期，请重新登录');
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * SDK 回调处理
 * 内部状态由本函数管理，外部行为通过 sdkEvents 事件发射器通知
 */
function handleSDKCallback(cbMsg) {
  try {
    const cb = JSON.parse(cbMsg);
    let func = cb.func || cb.event_name || cb.event || cb.method || '';
    let code = cb.code !== undefined ? Number(cb.code) : 0;
    let msg = cb.msg || cb.message || '';
    let param = cb.param || cb.data || {};

    console.log(`[SDK回调] func=${func}, code=${code}, msg=${msg}, raw=${JSON.stringify(cb)}`);

    const success = code === 0;

    // 内部状态处理
    if (func === 'OnSDKInitializeResult') {
      if (success) {
        sdkInitialized = true;
        console.log('SDK 初始化成功');
        if (sdkInitResolve) sdkInitResolve(true);
      } else if (sdkInitialized) {
        console.log('SDK 已初始化，忽略重复初始化回调:', msg);
      } else {
        console.error('SDK 初始化失败:', code, msg);
        if (sdkInitReject) sdkInitReject(new Error(`SDK 初始化失败: ${code} ${msg}`));
      }
    } else if (func === 'OnLogin') {
      if (success) {
        sdkLoggedIn = true;
        console.log('SDK 登录成功');
        if (sdkLoginResolve) sdkLoginResolve(true);
      } else if (sdkLoggedIn) {
        console.log('SDK 已登录，忽略重复登录回调:', msg);
      } else {
        console.error('SDK 登录失败:', code, msg);
        if (sdkLoginReject) sdkLoginReject(new Error(`SDK 登录失败: ${code} ${msg}`));
      }
    } else if (func === 'OnLogout') {
      sdkLoggedIn = false;
      console.log('SDK 登出回调');
    } else if (func === 'OnSDKUninitializeResult') {
      sdkInitialized = false;
      sdkLoggedIn = false;
      console.log('SDK 反初始化回调');
    }

    // 发射事件供外部模块处理（轮询、选人组件等）
    sdkEvents.emit('callback', { func, code, msg, param, success, raw: cbMsg });

    // 通知渲染进程
    const mainWindow = _getMainWindow ? _getMainWindow() : null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sdk-callback', cbMsg);
    }
  } catch (err) {
    console.error('解析 SDK 回调失败:', err);
  }
}

/**
 * 初始化 SDK（带并发保护和重试）
 */
async function initSDK() {
  if (!wemeetSdk) {
    console.warn('SDK 未加载，跳过初始化');
    return false;
  }

  if (sdkInitialized) {
    console.log('SDK 已初始化，跳过');
    return true;
  }

  if (sdkInitializing) {
    console.log('SDK 正在初始化中，等待完成...');
    try {
      await sdkInitPromise;
      return true;
    } catch {
      // 已有初始化失败，下方会重试
    }
  }

  sdkInitializing = true;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      sdkInitPromise = new Promise((resolve, reject) => {
        sdkInitResolve = resolve;
        sdkInitReject = reject;
      });

      const sdkData = await api.getSdkToken();
      tokenStore.saveSdkToken(sdkData);

      const sdkId = String(sdkData.sdkId);
      const sdkToken = sdkData.sdkToken;
      const dataPath = app.getPath('userData');
      const appName = app.getName();

      console.log(`开始初始化 SDK (第 ${attempt}/${MAX_RETRY} 次), sdkId:`, sdkId);

      wemeetSdk.InitWemeetSDK(
        sdkId,
        sdkToken,
        dataPath,
        appName,
        appIconPath,
        'zh-cn',
        '',
        'false'
      );

      await sdkInitPromise;
      sdkInitializing = false;
      return true;
    } catch (err) {
      console.error(`SDK 初始化失败 (第 ${attempt}/${MAX_RETRY} 次):`, err.message);
      if (attempt < MAX_RETRY) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  console.error(`SDK 初始化失败，已重试 ${MAX_RETRY} 次`);
  sdkInitializing = false;
  return false;
}

/**
 * 确保 SDK 已初始化，未初始化则先初始化
 */
async function ensureSDKInitialized() {
  if (!wemeetSdk) {
    console.warn('SDK 未加载，无法初始化');
    return false;
  }
  if (sdkInitialized) {
    return true;
  }
  console.log('SDK 未初始化，开始初始化...');
  return await initSDK();
}

/**
 * 确保 SDK 已登录，未登录则自动获取 ID Token 并登录
 */
async function ensureSDKLoggedIn() {
  if (!wemeetSdk) {
    console.warn('SDK 未加载');
    return false;
  }

  if (sdkLoggedIn) {
    return true;
  }

  const initSuccess = await ensureSDKInitialized();
  if (!initSuccess) {
    console.warn('SDK 初始化失败，无法登录');
    return false;
  }

  if (sdkLoggedIn) {
    return true;
  }

  try {
    const accessToken = await getValidAccessToken();
    const idTokenData = await api.getIdToken(accessToken);
    tokenStore.saveIdToken(idTokenData);

    if (idTokenData.ssoUrl) {
      const loginSuccess = await sdkLogin(idTokenData.ssoUrl);
      if (loginSuccess) {
        console.log('SDK 自动登录成功');
        return true;
      } else {
        console.warn('SDK 自动登录失败');
        return false;
      }
    } else {
      console.warn('无法获取 ssoUrl，SDK 登录失败');
      return false;
    }
  } catch (err) {
    console.error('SDK 自动登录异常:', err.message);
    return false;
  }
}

/**
 * SDK 登录（使用 LoginByJSON，带并发保护和重试）
 * @param {string} ssoUrl - SSO URL 前缀 + ID Token 拼接的完整地址
 */
async function sdkLogin(ssoUrl) {
  if (!wemeetSdk || !sdkInitialized) {
    console.warn('SDK 未初始化，跳过登录');
    return false;
  }

  if (sdkLoggedIn) {
    console.log('SDK 已登录，跳过');
    return true;
  }

  if (sdkLoggingIn) {
    console.log('SDK 正在登录中，等待完成...');
    try {
      await currentSdkLoginPromise;
      return true;
    } catch {
      // 已有登录失败，下方会重试
    }
  }

  sdkLoggingIn = true;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      currentSdkLoginPromise = new Promise((resolve, reject) => {
        sdkLoginResolve = resolve;
        sdkLoginReject = reject;
      });

      const loginJson = JSON.stringify({
        login_type: 0,
        force_kick_other_device: true,
        login_params: {
          sso_url: ssoUrl,
        },
      });
      console.log(`SDK 开始登录 (第 ${attempt}/${MAX_RETRY} 次), JSON 长度:`, loginJson.length, '字节');
      if (loginJson.length > 1000) {
        console.warn('警告: LoginByJSON 的 JSON 字符串超过 1000 字节，C++ 侧 buf 仅有 1024 字节，可能被截断');
      }
      wemeetSdk.LoginByJSON(loginJson);
      await currentSdkLoginPromise;
      sdkLoggingIn = false;
      return true;
    } catch (err) {
      console.error(`SDK 登录失败 (第 ${attempt}/${MAX_RETRY} 次):`, err.message);
      if (attempt < MAX_RETRY) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  console.error(`SDK 登录失败，已重试 ${MAX_RETRY} 次`);
  sdkLoggingIn = false;
  return false;
}

/**
 * 启用会中邀请回调（选人组件）
 * 建议在初始化回调之后、登录之前设置，但登录后设置也有效
 */
function enableInviteCallbacks() {
  if (!wemeetSdk || !sdkInitialized) {
    console.warn('[选人组件] SDK 未初始化，无法启用邀请回调');
    return;
  }
  try {
    wemeetSdk.EnableInviteUsersCallback(true, false);
    wemeetSdk.SetNeedShareCallback(true, false);
    console.log('[选人组件] 已启用邀请回调（隐藏SDK默认通讯录）');
  } catch (err) {
    console.error('[选人组件] 启用邀请回调失败:', err.message);
  }
}

/**
 * 处理腾讯会议 scheme 唤起 URL
 *
 * 客户端被 wemeetsdk:// 链接唤起后，将 scheme 之后的部分
 * （例如 page/inmeeting?meeting_code=xxx&launch_id=yyy）
 * 透传给 SDK 的 HandleSchema 接口，由 SDK 自行解析并入会。
 *
 * 调用前会确保 SDK 已初始化并登录，登录失败时返回 false。
 *
 * @param {string} url - 完整的 scheme URL，如 wemeetsdk://page/inmeeting?...
 * @returns {Promise<{success: boolean, message?: string}>>}
 */
async function handleScheme(url) {
  if (!wemeetSdk) {
    console.warn('[Scheme] SDK 未加载，无法处理 scheme URL');
    return { success: false, message: 'SDK 未加载' };
  }

  if (!sdkInitialized) {
    const ok = await ensureSDKInitialized();
    if (!ok) {
      console.error('[Scheme] SDK 初始化失败，无法处理 scheme URL');
      return { success: false, message: 'SDK 初始化失败' };
    }
  }

  if (!sdkLoggedIn) {
    const ok = await ensureSDKLoggedIn();
    if (!ok) {
      console.error('[Scheme] SDK 未登录，无法处理 scheme URL');
      return { success: false, message: 'SDK 未登录' };
    }
  }

  // 提取 scheme 之后的内容
  const prefix = `${SCHEME_NAME}://`;
  let schemaPath = url || '';
  if (schemaPath.startsWith(prefix)) {
    schemaPath = schemaPath.slice(prefix.length);
  } else {
    // 兼容传入不含 scheme 前缀的情况
    const idx = schemaPath.indexOf('://');
    if (idx >= 0) {
      schemaPath = schemaPath.slice(idx + 3);
    }
  }

  if (!schemaPath) {
    console.warn('[Scheme] scheme 路径为空，URL:', url);
    return { success: false, message: 'scheme 路径为空' };
  }

  try {
    console.log('[Scheme] 调用 SDK HandleSchema:', schemaPath);
    wemeetSdk.HandleSchema(schemaPath);
    return { success: true };
  } catch (err) {
    console.error('[Scheme] HandleSchema 调用异常:', err.message);
    return { success: false, message: err.message };
  }
}

/**
 * 等待 SDK 登录完成（供渲染进程调用）
 */
function waitSdkLogin() {
  return new Promise((resolve) => {
    if (sdkLoggedIn) {
      resolve({ success: true });
      return;
    }

    const TIMEOUT = 30000;
    const INTERVAL = 500;
    const startTime = Date.now();

    const check = () => {
      if (sdkLoggedIn) {
        resolve({ success: true });
        return;
      }
      if (Date.now() - startTime > TIMEOUT) {
        resolve({ success: false, message: 'SDK 登录超时，请重试' });
        return;
      }
      setTimeout(check, INTERVAL);
    };

    check();
  });
}

// 状态访问器
function isSdkInitialized() { return sdkInitialized; }
function isSdkLoggedIn() { return sdkLoggedIn; }
function setSdkLoggedIn(val) { sdkLoggedIn = val; }
function setSdkInitialized(val) { sdkInitialized = val; }

function uninitSDK() {
  if (wemeetSdk && sdkInitialized) {
    try {
      wemeetSdk.UninitWemeetSDK('{"force": true}');
      sdkInitialized = false;
      sdkLoggedIn = false;
    } catch (err) {
      console.error('SDK 反初始化失败:', err.message);
    }
  }
}

module.exports = {
  wemeetSdk,
  appIconPath,
  SCHEME_NAME,
  sdkEvents,
  initCallbackHandler,
  handleSDKCallback,
  initSDK,
  ensureSDKInitialized,
  ensureSDKLoggedIn,
  sdkLogin,
  getValidAccessToken,
  enableInviteCallbacks,
  handleScheme,
  waitSdkLogin,
  isSdkInitialized,
  isSdkLoggedIn,
  setSdkLoggedIn,
  setSdkInitialized,
  uninitSDK,
};
