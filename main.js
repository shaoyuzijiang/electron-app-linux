const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const api = require('./api');
const tokenStore = require('./token-store');

// 应用图标路径
const appIconPath = path.join(__dirname, 'app.png');

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

try {
  if (process.platform === 'darwin') {
    // 优先加载通用文件名（universal 构建产物），回退到架构特定文件（开发模式）
    try {
      wemeetSdk = require('./output/mac/wemeet_electron_sdk.node');
    } catch {
      const arch = process.arch;
      try {
        wemeetSdk = require(`./output/mac/wemeet_electron_sdk.${arch}.node`);
      } catch {
        console.error('无法加载腾讯会议 SDK 原生模块');
      }
    }
  } else if (process.platform === 'win32' && process.arch === 'x64') {
    wemeetSdk = require('./output/win/x64/wemeet_electron_sdk.node');
  } else if (process.platform === 'win32') {
    wemeetSdk = require('./output/win/win32/wemeet_electron_sdk.node');
  }
  console.log('腾讯会议 SDK 加载成功，版本:', wemeetSdk.GetSDKVersion());
} catch (err) {
  console.warn('腾讯会议 SDK 加载失败:', err.message);
  console.warn('会议相关功能将不可用，请先运行 npm run build 编译 SDK');
}

let mainWindow;
let userPickerWindow = null; // 选人组件独立窗口

// ========== 会议列表推送相关 ==========
let meetingListRefreshTimer = null; // 防抖定时器
let pollingTimer = null;            // 轮询定时器
const POLLING_INTERVAL = 5 * 60 * 1000; // 5 分钟

/**
 * 防抖刷新会议列表并推送给渲染进程
 */
function scheduleMeetingListRefresh() {
  if (meetingListRefreshTimer) clearTimeout(meetingListRefreshTimer);
  meetingListRefreshTimer = setTimeout(async () => {
    try {
      const accessToken = await getValidAccessToken();
      const result = await api.getMeetingList(accessToken, { instanceid: 2, is_show_all_sub_meetings: '1' });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('meeting-list-updated', { success: true, data: result });
      }
    } catch (err) {
      console.error('推送会议列表失败:', err.message);
    }
  }, 300);
}

/**
 * 启动会议列表定时轮询
 */
function startMeetingListPolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    if (!sdkLoggedIn || !mainWindow || mainWindow.isDestroyed()) return;
    scheduleMeetingListRefresh();
  }, POLLING_INTERVAL);
  console.log('[会议列表轮询] 已启动，间隔', POLLING_INTERVAL / 1000, '秒');
}

/**
 * 停止会议列表定时轮询
 */
function stopMeetingListPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log('[会议列表轮询] 已停止');
  }
}

/**
 * 获取有效的 accessToken，如果已过期则自动刷新
 */
async function getValidAccessToken() {
  const tokens = tokenStore.getTokens();
  if (!tokens) {
    throw new Error('未登录');
  }

  if (!tokenStore.isAccessTokenExpired()) {
    return tokens.accessToken;
  }

  const newTokenData = await api.refreshToken(tokens.refreshToken);
  tokenStore.saveTokens(newTokenData);
  return newTokenData.accessToken;
}

/**
 * SDK 回调处理
 */
function handleSDKCallback(cbMsg) {
  try {
    const cb = JSON.parse(cbMsg);
    const { func, code, msg, param } = cb;
    console.log(`[SDK回调] func=${func}, code=${code}, msg=${msg}`);

    const success = Number(code) === 0;

    if (func === 'OnSDKInitializeResult') {
      if (success) {
        sdkInitialized = true;
        console.log('SDK 初始化成功');
        if (sdkInitResolve) sdkInitResolve(true);
      } else if (sdkInitialized) {
        // 已初始化成功的重复初始化回调，忽略
        console.log('SDK 已初始化，忽略重复初始化回调:', msg);
      } else {
        console.error('SDK 初始化失败:', msg);
        if (sdkInitReject) sdkInitReject(new Error(`SDK 初始化失败: ${msg}`));
      }
    } else if (func === 'OnLogin') {
      if (success) {
        sdkLoggedIn = true;
        startMeetingListPolling();
        scheduleMeetingListRefresh();
        enableInviteCallbacks();
        console.log('SDK 登录成功');
        if (sdkLoginResolve) sdkLoginResolve(true);
      } else if (sdkLoggedIn) {
        // 已登录成功的重复登录回调，忽略
        console.log('SDK 已登录，忽略重复登录回调:', msg);
      } else {
        console.error('SDK 登录失败:', msg);
        if (sdkLoginReject) sdkLoginReject(new Error(`SDK 登录失败: ${msg}`));
      }
    } else if (func === 'OnLogout') {
      sdkLoggedIn = false;
      stopMeetingListPolling();
      console.log('SDK 登出回调');
    } else if (func === 'OnInviteUsers') {
      console.log('[选人组件] 收到 OnInviteUsers 回调:', msg);
      openUserPickerWindow('invite_users', cbMsg);
    } else if (func === 'OnInviteMeeting') {
      console.log('[选人组件] 收到 OnInviteMeeting 回调:', msg);
      openUserPickerWindow('invite_meeting', cbMsg);
    } else if (func === 'OnAddUsersResult') {
      console.log('[选人组件] 收到 OnAddUsersResult 回调, code:', code, 'msg:', msg);
      if (userPickerWindow && !userPickerWindow.isDestroyed()) {
        userPickerWindow.webContents.send('add-users-result-callback', cbMsg);
      }
    } else if (func === 'OnSDKUninitializeResult') {
      sdkInitialized = false;
      sdkLoggedIn = false;
      stopMeetingListPolling();
      console.log('SDK 反初始化回调');
    }

    // 会议相关回调驱动列表刷新
    if (['OnLeaveMeeting', 'OnInviteMeeting', 'OnRingInvitationEvent', 'OnJoinMeeting'].includes(func)) {
      scheduleMeetingListRefresh();
    }

    // 通知渲染进程
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

  // 如果正在初始化中，等待已有的初始化完成，不重复调用
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
      // 每次尝试前重建 Promise
      sdkInitPromise = new Promise((resolve, reject) => {
        sdkInitResolve = resolve;
        sdkInitReject = reject;
      });

      // 获取 SDK Token
      const sdkData = await api.getSdkToken();
      tokenStore.saveSdkToken(sdkData);

      const sdkId = String(sdkData.sdkId);
      const sdkToken = sdkData.sdkToken;
      const dataPath = app.getPath('userData');
      const appName = app.getName();

      console.log(`开始初始化 SDK (第 ${attempt}/${MAX_RETRY} 次), sdkId:`, sdkId);

      // InitWemeetSDK 位置参数: sdk_id, sdk_token, data_path, app_name, app_icon, prefer_language, proxy_info, allow_home_view
      wemeetSdk.InitWemeetSDK(
        sdkId,       // sdk_id (string, 必填)
        sdkToken,    // sdk_token (string, 必填)
        dataPath,    // data_path (string, 选填)
        appName,     // app_name (string, 选填)
        '',          // app_icon (string, 选填)
        'zh-cn',     // prefer_language (string, 选填)
        '',          // proxy_info (string, 选填)
        false        // allow_home_view (bool, 选填)
      );

      // 等待初始化回调
      await sdkInitPromise;
      sdkInitializing = false;
      return true;
    } catch (err) {
      console.error(`SDK 初始化失败 (第 ${attempt}/${MAX_RETRY} 次):`, err.message);
      if (attempt < MAX_RETRY) {
        // 短暂延迟后重试
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

  // 先确保初始化
  const initSuccess = await ensureSDKInitialized();
  if (!initSuccess) {
    console.warn('SDK 初始化失败，无法登录');
    return false;
  }

  // 已登录
  if (sdkLoggedIn) {
    return true;
  }

  // 获取 ID Token 并登录
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

  // 如果正在登录中，等待已有的登录完成，不重复调用
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
      // 每次尝试前重建 Promise
      currentSdkLoginPromise = new Promise((resolve, reject) => {
        sdkLoginResolve = resolve;
        sdkLoginReject = reject;
      });

      const loginJson = JSON.stringify({
        login_type: 0,                  // 0: SSOURL 登录
        force_kick_other_device: true,  // 强制踢出已登录的同端设备
        login_params: {
          sso_url: ssoUrl,              // ssoUrl（已包含 idToken）
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
 * 获取会中窗口位置信息
 * @returns {object|null} { x, y, width, height } 或 null
 *
 * GetMeetingWindowInfo() 返回 JSON 字符串，结构如下：
 * {
 *   "code": 0,
 *   "msg": "",
 *   "data": {
 *     "in_meeting_mode": true,
 *     "in_screen_share_mode": false,
 *     "in_meeting_min_wnd_mode": false,
 *     "window_rect": { "x": 0, "y": 0, "width": 0, "height": 0 }
 *   }
 * }
 * 仅在会中且非屏幕共享、非最小化时 window_rect 有效。
 */
function getMeetingWindowInfo() {
  if (!wemeetSdk) return null;
  try {
    const raw = wemeetSdk.GetMeetingWindowInfo();
    if (!raw || raw === '') return null;
    const result = JSON.parse(raw);
    // code 不为 0 表示不在会中或调用非法
    if (!result || result.code !== 0 || !result.data) return null;
    const data = result.data;
    // 非会中状态、屏幕共享状态、最小化状态时 window_rect 无效
    if (!data.in_meeting_mode || data.in_screen_share_mode || data.in_meeting_min_wnd_mode) {
      console.warn('[选人组件] 会中窗口状态不适合定位:', {
        in_meeting_mode: data.in_meeting_mode,
        in_screen_share_mode: data.in_screen_share_mode,
        in_meeting_min_wnd_mode: data.in_meeting_min_wnd_mode,
      });
      return null;
    }
    const rect = data.window_rect;
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  } catch (err) {
    console.error('[选人组件] GetMeetingWindowInfo 失败:', err.message);
    return null;
  }
}

/**
 * 打开选人组件独立窗口，定位到会中窗口上方
 * @param {string} type - 'invite_users' 或 'invite_meeting'
 * @param {string} cbMsg - SDK 回调原始 JSON 消息
 */
function openUserPickerWindow(type, cbMsg) {
  // 如果已有选人窗口则先关闭
  if (userPickerWindow && !userPickerWindow.isDestroyed()) {
    userPickerWindow.close();
    userPickerWindow = null;
  }

  // 获取会中窗口位置
  const meetingWinInfo = getMeetingWindowInfo();
  console.log('[选人组件] 会中窗口信息:', JSON.stringify(meetingWinInfo));

  const pickerWidth = 800;
  const pickerHeight = 560;

  let posX, posY;
  if (meetingWinInfo && typeof meetingWinInfo.x === 'number' && typeof meetingWinInfo.y === 'number') {
    // 居中于 SDK 会中窗口
    posX = Math.round(meetingWinInfo.x + (meetingWinInfo.width - pickerWidth) / 2);
    posY = Math.round(meetingWinInfo.y + (meetingWinInfo.height - pickerHeight) / 2);
    console.log('[选人组件] 基于 SDK 会中窗口定位:', { posX, posY });
  } else {
    // 回退：居中于主窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      const mainBounds = mainWindow.getBounds();
      posX = Math.round(mainBounds.x + (mainBounds.width - pickerWidth) / 2);
      posY = Math.round(mainBounds.y + (mainBounds.height - pickerHeight) / 2);
    } else {
      posX = undefined;
      posY = undefined;
    }
  }

  userPickerWindow = new BrowserWindow({
    width: pickerWidth,
    height: pickerHeight,
    minWidth: 700,
    minHeight: 480,
    x: posX,
    y: posY,
    title: type === 'invite_meeting' ? '邀请参会' : '邀请成员',
    resizable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  userPickerWindow.loadFile(path.join(__dirname, 'renderer', 'user-picker.html'));

  // 窗口加载完成后发送回调数据
  userPickerWindow.webContents.on('did-finish-load', () => {
    userPickerWindow.webContents.send('picker-init-data', { type, cbMsg });
  });

  userPickerWindow.on('closed', () => {
    userPickerWindow = null;
  });

  // 失去焦点时不自动关闭（避免误操作）
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
    // EnableInviteUsersCallback: 会中管理成员邀请回调，enable=true, show=false 表示启用回调且隐藏SDK默认通讯录
    wemeetSdk.EnableInviteUsersCallback(true, false);
    // SetNeedShareCallback: 会中工具栏邀请回调（底层调用 EnableInviteCallback），enable=true, show=false
    wemeetSdk.SetNeedShareCallback(true, false);
    console.log('[选人组件] 已启用邀请回调（隐藏SDK默认通讯录）');
  } catch (err) {
    console.error('[选人组件] 启用邀请回调失败:', err.message);
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

function createWindow() {
  // macOS 开发模式下设置 Dock 图标
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock.setIcon(nativeImage.createFromPath(appIconPath));
  }

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: '腾讯会议SDK Demo',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));

  // 检查是否已有有效 token，自动登录
  if (!tokenStore.isAccessTokenExpired()) {
    const tokens = tokenStore.getTokens();
    if (tokens) {
      (async () => {
        try {
          const accessToken = await getValidAccessToken();
          const profile = await api.getProfile(accessToken);

          // 并行获取 ID Token + SDK 登录（不阻塞页面跳转）
          (async () => {
            try {
              // 确保 SDK 初始化完成
              const initSuccess = await ensureSDKInitialized();
              if (!initSuccess) {
                console.warn('自动登录：SDK 初始化失败，跳过 SDK 登录');
                return;
              }

              const idTokenData = await api.getIdToken(accessToken);
              tokenStore.saveIdToken(idTokenData);

              if (idTokenData.ssoUrl) {
                const loginSuccess = await sdkLogin(idTokenData.ssoUrl);
                if (loginSuccess) {
                  console.log('自动登录 SDK 登录成功');
                  startMeetingListPolling();
                  scheduleMeetingListRefresh();
                }
              } else {
                console.warn('自动登录 SDK 条件不满足:', { hasSsoUrl: !!(idTokenData && idTokenData.ssoUrl) });
              }
            } catch (err) {
              console.error('自动登录 SDK 流程异常:', err.message);
            }
          })();

          // 直接跳转首页
          mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
        } catch (err) {
          console.warn('自动登录失败，显示登录页:', err.message);
          tokenStore.clearTokens();
        }
      })();
    }
  }

  if (!app.isPackaged) {
    // mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopMeetingListPolling();
  });

  // 窗口从最小化恢复时刷新会议列表
  mainWindow.on('restore', () => {
    if (sdkLoggedIn) {
      scheduleMeetingListRefresh();
    }
  });

  // 注册 SDK 回调
  if (wemeetSdk) {
    wemeetSdk.AddJsCallback(handleSDKCallback);
  }
}

app.whenReady().then(() => {
  createWindow();

  // 预取公钥（不阻塞，登录时可直接使用缓存）
  api.prefetchPublicKey();

  // 应用启动时初始化 SDK
  initSDK().then((success) => {
    if (success) {
      console.log('SDK 初始化完成');
    } else {
      console.warn('SDK 初始化未成功，会议功能不可用');
    }
  }).catch((err) => {
    console.error('SDK 初始化异常:', err.message);
  });

  // 登录
  ipcMain.handle('login', async (_event, { username, password }) => {
    try {
      // 1. 账号登录，获取 accessToken
      const tokenData = await api.login(username, password);
      tokenStore.saveTokens(tokenData);

      // 2. 获取用户信息（验证登录成功）
      const profile = await api.getProfile(tokenData.accessToken);

      // 3. ID Token + SDK 登录在后台异步完成，不阻塞页面跳转
      (async () => {
        try {
          // 确保 SDK 初始化完成
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

  // 登录成功后切换到首页
  ipcMain.on('login-success', () => {
    if (mainWindow) {
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    }
  });

  // 获取用户信息（首页使用）
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

  // 退出登录
  ipcMain.handle('logout', async () => {
    // 停止会议列表轮询
    stopMeetingListPolling();

    // SDK 登出
    if (wemeetSdk && sdkLoggedIn) {
      try {
        wemeetSdk.Logout();
        sdkLoggedIn = false;
      } catch (err) {
        console.error('SDK 登出失败:', err.message);
      }
    }
    tokenStore.clearTokens();
    tokenStore.clearMeetingTokens();
    if (mainWindow) {
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
    }
    return { success: true };
  });

  // 创建会议
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

  // 查询用户会议列表
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

  // 修改密码
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

  // 获取 SDK Token 数据
  ipcMain.handle('get-sdk-token', () => {
    return tokenStore.getSdkToken() || null;
  });

  // 获取 ID Token 数据
  ipcMain.handle('get-id-token', () => {
    return tokenStore.getIdToken() || null;
  });

  // 重新获取 ID Token
  ipcMain.handle('fetch-id-token', async () => {
    try {
      const accessToken = await getValidAccessToken();
      const idTokenData = await api.getIdToken(accessToken);
      tokenStore.saveIdToken(idTokenData);

      // 重新使用新的 ID Token 登录 SDK
      if (wemeetSdk && sdkInitialized && idTokenData.ssoUrl) {
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

  // 获取 SDK 状态
  ipcMain.handle('get-sdk-status', () => {
    return {
      loaded: !!wemeetSdk,
      initialized: sdkInitialized,
      loggedIn: sdkLoggedIn,
      version: wemeetSdk ? wemeetSdk.GetSDKVersion() : null,
    };
  });

  // 等待 SDK 登录完成
  ipcMain.handle('wait-sdk-login', () => waitSdkLogin());

  // 加入会议
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

  // 通过 JSON 加入会议
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

  // 快速会议
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

  // 离开会议
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

  // 显示会前界面（Home 页）
  ipcMain.handle('show-pre-meeting-view', async () => {
    if (!(await ensureSDKLoggedIn())) {
      return { success: false, message: 'SDK 未就绪，请重新登录' };
    }
    try {
      wemeetSdk.ShowPreMeetingView();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // 显示加入会议页面
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

  // 显示预定会议页面
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

  // 显示设置页面
  ipcMain.handle('show-meeting-setting-view', async () => {
    if (!wemeetSdk || !sdkInitialized) {
      return { success: false, message: 'SDK 未就绪' };
    }
    try {
      wemeetSdk.ShowMeetingSettingView();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // 显示投屏页面
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

  // 上传腾讯会议日志
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

  // ========== 选人组件 IPC 接口 ==========

  // 获取部门树
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

  // 获取部门下的用户
  ipcMain.handle('get-department-users', async (_event, { departmentId, recursive }) => {
    try {
      const accessToken = await getValidAccessToken();
      const data = await api.getDepartmentUsers(accessToken, departmentId, recursive);
      return { success: true, data };
    } catch (err) {
      if (err.message === '未登录') {
        return { success: false, message: '未登录，请重新登录' };
      }
      return { success: false, message: err.message };
    }
  });

  // 搜索用户
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

  // 获取会中窗口位置信息
  ipcMain.handle('get-meeting-window-info', async () => {
    const info = getMeetingWindowInfo();
    return { success: !!info, data: info };
  });

  // 关闭选人组件窗口
  ipcMain.handle('close-user-picker-window', async () => {
    if (userPickerWindow && !userPickerWindow.isDestroyed()) {
      userPickerWindow.close();
      userPickerWindow = null;
    }
    return { success: true };
  });

  // 启用邀请回调开关
  ipcMain.handle('enable-invite-callbacks', async () => {
    if (!wemeetSdk || !sdkInitialized) {
      return { success: false, message: 'SDK 未初始化' };
    }
    try {
      enableInviteCallbacks();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // 呼叫用户入会（选人后调用）
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

  // 启用自定义组织架构
  ipcMain.handle('enable-custom-org-info', async (_event, { enable }) => {
    if (!wemeetSdk || !sdkInitialized) {
      return { success: false, message: 'SDK 未初始化' };
    }
    try {
      wemeetSdk.EnableCustomOrgInfo(enable);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // 设置自定义组织架构信息
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
});

app.on('window-all-closed', () => {
  // 反初始化 SDK
  if (wemeetSdk && sdkInitialized) {
    try {
      wemeetSdk.UninitWemeetSDK('{"force": true}');
      sdkInitialized = false;
      sdkLoggedIn = false;
    } catch (err) {
      console.error('SDK 反初始化失败:', err.message);
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
