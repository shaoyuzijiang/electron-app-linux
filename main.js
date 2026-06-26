const { app, BrowserWindow, ipcMain, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const api = require('./backend_api/api');
const tokenStore = require('./utils/token-store');
const logger = require('./utils/logger');

// 模块导入
const wemeetSdkModule = require('./sdk_mgmt/wemeet-sdk');
const meetingPolling = require('./backend_api/meeting-polling');
const userPicker = require('./sdk_mgmt/user-picker');
const ipcHandlers = require('./ipc-handlers');

const { wemeetSdk, appIconPath, sdkEvents, handleSDKCallback } = wemeetSdkModule;

let mainWindow;

function getMainWindow() {
  return mainWindow;
}

// 初始化模块依赖
wemeetSdkModule.initCallbackHandler(getMainWindow);

meetingPolling.init({
  getValidAccessToken: wemeetSdkModule.getValidAccessToken,
  getMainWindow,
  isSdkLoggedIn: wemeetSdkModule.isSdkLoggedIn,
});

userPicker.init({
  wemeetSdk,
  getMainWindow,
});

// Refresh token 失效时停止会议轮询
sdkEvents.on('auth-expired', () => {
  console.log('[认证失效] Refresh token 已被撤销，停止会议轮询');
  meetingPolling.stopMeetingListPolling();
});

// 监听 SDK 回调事件，分发到各模块
sdkEvents.on('callback', ({ func, success, raw }) => {
  if (func === 'OnLogin' && success) {
    meetingPolling.startMeetingListPolling();
    meetingPolling.scheduleMeetingListRefresh();
    wemeetSdkModule.enableInviteCallbacks();
  } else if (func === 'OnLogout') {
    meetingPolling.stopMeetingListPolling();
  } else if (func === 'OnInviteUsers') {
    console.log('[选人组件] 收到 OnInviteUsers 回调');
    userPicker.openUserPickerWindow('invite_users', raw);
  } else if (func === 'OnInviteMeeting') {
    console.log('[选人组件] 收到 OnInviteMeeting 回调');
    userPicker.openUserPickerWindow('invite_meeting', raw);
  } else if (func === 'OnAddUsersResult') {
    console.log('[选人组件] 收到 OnAddUsersResult 回调');
    const win = userPicker.getUserPickerWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('add-users-result-callback', raw);
    }
  } else if (func === 'OnSDKUninitializeResult') {
    meetingPolling.stopMeetingListPolling();
  }

  // 会议相关回调驱动列表刷新
  if (['OnLeaveMeeting', 'OnInviteMeeting', 'OnRingInvitationEvent', 'OnJoinMeeting'].includes(func)) {
    meetingPolling.scheduleMeetingListRefresh();
  }
});

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
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'bootstrap', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
  mainWindow.setMenu(null);

  // 检查是否已有有效 token，自动登录
  if (!tokenStore.isAccessTokenExpired()) {
    const tokens = tokenStore.getTokens();
    if (tokens) {
      (async () => {
        try {
          const accessToken = await wemeetSdkModule.getValidAccessToken();
          const profile = await api.getProfile(accessToken);

          // 并行获取 ID Token + SDK 登录（不阻塞页面跳转）
          (async () => {
            try {
              const initSuccess = await wemeetSdkModule.ensureSDKInitialized();
              if (!initSuccess) {
                console.warn('自动登录：SDK 初始化失败，跳过 SDK 登录');
                return;
              }

              const idTokenData = await api.getIdToken(accessToken);
              tokenStore.saveIdToken(idTokenData);

              if (idTokenData.ssoUrl) {
                const loginSuccess = await wemeetSdkModule.sdkLogin(idTokenData.ssoUrl);
                if (loginSuccess) {
                  console.log('自动登录 SDK 登录成功');
                  meetingPolling.startMeetingListPolling();
                  meetingPolling.scheduleMeetingListRefresh();
                }
              } else {
                console.warn('自动登录 SDK 条件不满足:', { hasSsoUrl: !!(idTokenData && idTokenData.ssoUrl) });
              }
            } catch (err) {
              console.error('自动登录 SDK 流程异常:', err.message);
            }
          })();

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
    meetingPolling.stopMeetingListPolling();
  });

  mainWindow.on('restore', () => {
    handleSystemResume();
  });

  // 注册 SDK 回调
  if (wemeetSdk) {
    wemeetSdk.AddJsCallback(handleSDKCallback);
  }
}

/**
 * 系统休眠/锁屏恢复后的统一处理
 * 检测离线状态，如有保存的 refresh token 则自动重试登录
 */
async function handleSystemResume() {
  const tokens = tokenStore.getTokens();
  if (!tokens) {
    console.log('[系统恢复] 无已保存的凭据，跳过重连');
    return;
  }

  // 如果 SDK 已在线且 token 未过期，仅刷新会议列表
  if (wemeetSdkModule.isSdkLoggedIn() && !tokenStore.isAccessTokenExpired()) {
    console.log('[系统恢复] 在线状态正常，刷新会议列表');
    meetingPolling.scheduleMeetingListRefresh();
    return;
  }

  console.log('[系统恢复] 检测到离线状态，尝试重试登录...');
  try {
    const accessToken = await wemeetSdkModule.getValidAccessToken();
    const profile = await api.getProfile(accessToken);
    console.log('[系统恢复] Token 刷新成功，用户:', profile.email);

    // 尝试重新登录 SDK
    const sdkLoginSuccess = await wemeetSdkModule.ensureSDKLoggedIn();
    if (sdkLoginSuccess) {
      console.log('[系统恢复] SDK 重连成功');
      meetingPolling.startMeetingListPolling();
      meetingPolling.scheduleMeetingListRefresh();

      // 通知渲染进程刷新用户信息
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('system-resume-success', profile);
      }
    } else {
      console.warn('[系统恢复] SDK 重连失败');
    }
  } catch (err) {
    console.error('[系统恢复] 重试登录失败:', err.message);
    // refresh token 也失效了，清除凭据并通知渲染进程
    tokenStore.clearTokens();
    tokenStore.clearMeetingTokens();
    sdkEvents.emit('auth-expired');

    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('system-resume-failed', { message: err.message });
    }
  }
}

app.whenReady().then(() => {
  logger.install();
  createWindow();

  api.prefetchPublicKey();

  wemeetSdkModule.initSDK().then((success) => {
    if (success) {
      console.log('SDK 初始化完成');
    } else {
      console.warn('SDK 初始化未成功，会议功能不可用');
    }
  }).catch((err) => {
    console.error('SDK 初始化异常:', err.message);
  });

  // 注册 IPC 接口
  ipcHandlers.register(ipcMain, {
    wemeetSdk,
    getMainWindow,
    getValidAccessToken: wemeetSdkModule.getValidAccessToken,
    ensureSDKLoggedIn: wemeetSdkModule.ensureSDKLoggedIn,
    ensureSDKInitialized: wemeetSdkModule.ensureSDKInitialized,
    sdkLogin: wemeetSdkModule.sdkLogin,
    isSdkInitialized: wemeetSdkModule.isSdkInitialized,
    isSdkLoggedIn: wemeetSdkModule.isSdkLoggedIn,
    setSdkLoggedIn: wemeetSdkModule.setSdkLoggedIn,
    enableInviteCallbacks: wemeetSdkModule.enableInviteCallbacks,
    waitSdkLogin: wemeetSdkModule.waitSdkLogin,
    scheduleMeetingListRefresh: meetingPolling.scheduleMeetingListRefresh,
    startMeetingListPolling: meetingPolling.startMeetingListPolling,
    stopMeetingListPolling: meetingPolling.stopMeetingListPolling,
    getMeetingWindowInfo: userPicker.getMeetingWindowInfo,
    openUserPickerWindow: userPicker.openUserPickerWindow,
    closeUserPickerWindow: userPicker.closeUserPickerWindow,
    getUserPickerWindow: userPicker.getUserPickerWindow,
  });
});

// 系统从休眠/锁屏恢复时，自动检测并重试登录
powerMonitor.on('resume', () => {
  console.log('[系统唤醒] 检测到系统从休眠/锁屏状态恢复');
  // 延迟执行，等待网络连接恢复
  setTimeout(() => handleSystemResume(), 3000);
});

app.on('window-all-closed', () => {
  wemeetSdkModule.uninitSDK();
  logger.closeLog();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
