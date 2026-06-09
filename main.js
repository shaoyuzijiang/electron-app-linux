const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const api = require('./api');
const tokenStore = require('./token-store');

// 加载腾讯会议 SDK
let wemeetSdk = null;
let sdkInitialized = false;
let sdkLoggedIn = false;
let sdkInitResolve, sdkInitReject;
let sdkLoginResolve, sdkLoginReject;

const sdkInitPromise = new Promise((resolve, reject) => {
  sdkInitResolve = resolve;
  sdkInitReject = reject;
});

const sdkLoginPromise = new Promise((resolve, reject) => {
  sdkLoginResolve = resolve;
  sdkLoginReject = reject;
});

try {
  if (process.platform === 'darwin') {
    wemeetSdk = require('./output/mac/wemeet_electron_sdk.node');
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
        sdkInitResolve(true);
      } else {
        console.error('SDK 初始化失败:', msg);
        sdkInitReject(new Error(`SDK 初始化失败: ${msg}`));
      }
    } else if (func === 'OnLogin') {
      if (success) {
        sdkLoggedIn = true;
        console.log('SDK 登录成功');
        sdkLoginResolve(true);
      } else {
        console.error('SDK 登录失败:', msg);
        sdkLoginReject(new Error(`SDK 登录失败: ${msg}`));
      }
    } else if (func === 'OnLogout') {
      sdkLoggedIn = false;
      console.log('SDK 登出回调');
    } else if (func === 'OnSDKUninitializeResult') {
      sdkInitialized = false;
      sdkLoggedIn = false;
      console.log('SDK 反初始化回调');
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
 * 初始化 SDK
 */
async function initSDK() {
  if (!wemeetSdk) {
    console.warn('SDK 未加载，跳过初始化');
    return false;
  }

  try {
    // 获取 SDK Token
    const sdkData = await api.getSdkToken();
    tokenStore.saveSdkToken(sdkData);

    const sdkId = String(sdkData.sdkId);
    const sdkToken = sdkData.sdkToken;
    const dataPath = app.getPath('userData');
    const appName = app.getName();

    console.log('开始初始化 SDK, sdkId:', sdkId);

    // InitWemeetSDK 位置参数: sdk_id, sdk_token, data_path, app_name, app_icon, prefer_language, proxy_info, allow_home_view
    // 参考文档: https://github.com/Tencent-Meeting/TencentMeetingSDK/blob/main/Docs/Common/TencentMeetingSDK（TMSDK）接口参考文档.md#initialize
    wemeetSdk.InitWemeetSDK(
      sdkId,       // sdk_id (string, 必填) - SDK ID
      sdkToken,    // sdk_token (string, 必填) - SDK Token
      dataPath,    // data_path (string, 选填) - SDK 数据存储路径，仅 Windows/Linux 有效，Mac 端可传空串
      appName,     // app_name (string, 选填) - 显示的品牌名称，默认"网络会议"
      '',          // app_icon (string, 选填) - 窗口图标绝对路径，仅 Windows 端有效，Mac 传空串
      'zh-cn',     // prefer_language (string, 选填) - SDK 语言，支持 zh-cn/en-us/ja，默认 zh-cn
      '',          // proxy_info (string, 选填) - 网络代理 JSON 串，不使用代理传空串
      false        // allow_home_view (bool, 选填) - 是否使用 SDK 会议主面板，false 为不使用
    );

    // 等待初始化回调
    await sdkInitPromise;
    return true;
  } catch (err) {
    console.error('SDK 初始化失败:', err.message);
    return false;
  }
}

/**
 * SDK 登录（使用 LoginByJSON）
 * @param {string} ssoUrl - SSO URL 前缀 + ID Token 拼接的完整地址
 */
async function sdkLogin(ssoUrl) {
  if (!wemeetSdk || !sdkInitialized) {
    console.warn('SDK 未初始化，跳过登录');
    return false;
  }

  try {
    const loginJson = JSON.stringify({
      login_type: 0,                  // 0: SSOURL 登录
      force_kick_other_device: true,  // 强制踢出已登录的同端设备
      login_params: {
        sso_url: ssoUrl,              // ssoUrl（已包含 idToken）
      },
    });
    console.log('SDK 开始登录 (LoginByJSON), JSON 长度:', loginJson.length, '字节');
    console.log('LoginByJSON 参数:', loginJson);
    if (loginJson.length > 1000) {
      console.warn('警告: LoginByJSON 的 JSON 字符串超过 1000 字节，C++ 侧 buf 仅有 1024 字节，可能被截断');
    }
    wemeetSdk.LoginByJSON(loginJson);
    await sdkLoginPromise;
    return true;
  } catch (err) {
    console.error('SDK 登录失败:', err.message);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 注册 SDK 回调
  if (wemeetSdk) {
    wemeetSdk.AddJsCallback(handleSDKCallback);
  }
}

app.whenReady().then(() => {
  createWindow();

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

      // 2. 用 accessToken 获取用户信息（验证登录成功）
      const profile = await api.getProfile(tokenData.accessToken);

      // 3. 登录已确认成功，再获取 ID Token
      try {
        const idTokenData = await api.getIdToken(tokenData.accessToken);
        console.log('idTokenData:', JSON.stringify(idTokenData, null, 2));
        tokenStore.saveIdToken(idTokenData);

        // 4. 使用 ssoUrl 通过 LoginByJSON 登录腾讯会议 SDK（ssoUrl 已包含 idToken）
        if (wemeetSdk && sdkInitialized && idTokenData.ssoUrl) {
          sdkLogin(idTokenData.ssoUrl).then((loginSuccess) => {
            if (loginSuccess) {
              console.log('腾讯会议 SDK 登录成功');
            }
          }).catch((err) => {
            console.error('腾讯会议 SDK 登录异常:', err.message);
          });
        } else {
          console.warn('SDK 登录跳过: ssoUrl 缺失');
        }
      } catch (err) {
        console.error('获取 ID Token 失败:', err.message);
        tokenStore.saveIdToken({ error: err.message });
      }

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

  // 加入会议
  ipcMain.handle('join-meeting', async (_event, { meetingCode, displayName, password }) => {
    if (!wemeetSdk || !sdkInitialized || !sdkLoggedIn) {
      return { success: false, message: 'SDK 未就绪' };
    }
    try {
      wemeetSdk.JoinMeeting(meetingCode, displayName, password || '', '', 1, 0, 1, 0, '');
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // 通过 JSON 加入会议
  ipcMain.handle('join-meeting-by-json', async (_event, { meetingJson }) => {
    if (!wemeetSdk || !sdkInitialized || !sdkLoggedIn) {
      return { success: false, message: 'SDK 未就绪' };
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
    if (!wemeetSdk || !sdkInitialized || !sdkLoggedIn) {
      return { success: false, message: 'SDK 未就绪' };
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
    if (!wemeetSdk || !sdkInitialized || !sdkLoggedIn) {
      return { success: false, message: 'SDK 未就绪' };
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
    if (!wemeetSdk || !sdkInitialized || !sdkLoggedIn) {
      return { success: false, message: 'SDK 未就绪' };
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
    if (!wemeetSdk || !sdkInitialized || !sdkLoggedIn) {
      return { success: false, message: 'SDK 未就绪' };
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
    if (!wemeetSdk || !sdkInitialized || !sdkLoggedIn) {
      return { success: false, message: 'SDK 未就绪' };
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
    if (!wemeetSdk || !sdkInitialized || !sdkLoggedIn) {
      return { success: false, message: 'SDK 未就绪' };
    }
    try {
      wemeetSdk.ShowUploadLogsView();
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
