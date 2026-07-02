const { app, BrowserWindow, ipcMain, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const api = require('./backend_api/api');
const tokenStore = require('./utils/token-store');
const logger = require('./utils/logger');

// 模块导入
const wemeetSdkModule = require('./sdk_mgmt/wemeet-sdk');
const meetingPolling = require('./backend_api/meeting-polling');
const userPicker = require('./sdk_mgmt/user-picker');
const webviewManager = require('./utils/webview-manager');
const avatarMenuWindow = require('./utils/avatar-menu-window');
const ipcHandlers = require('./ipc-handlers');

const { wemeetSdk, appIconPath, sdkEvents, handleSDKCallback, SCHEME_NAME } = wemeetSdkModule;

let mainWindow;

// 挂起的 scheme URL：冷启动唤起或 SDK 尚未登录时暂存，待 OnLogin 成功后处理
let pendingSchemeUrl = null;

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

    // 冷启动通过 scheme 唤起时，SDK 登录成功后处理挂起的 URL
    if (pendingSchemeUrl) {
      const url = pendingSchemeUrl;
      pendingSchemeUrl = null;
      console.log('[Scheme] SDK 登录成功，开始处理挂起的 scheme URL');
      wemeetSdkModule.handleScheme(url).catch((err) => {
        console.error('[Scheme] 处理挂起 URL 失败:', err.message);
      });
    }
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
      // 通过 additionalArguments 把 isDev 标志传给 preload，避免 process.defaultApp 不可靠的问题
      additionalArguments: [`--is-dev=${!app.isPackaged ? '1' : '0'}`],
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
  mainWindow.setMenu(null);

  // 初始化 webview 管理模块
  webviewManager.init(mainWindow);
  // 初始化头像菜单悬浮窗模块
  avatarMenuWindow.init({ getMainWindow });

  // 主窗口移动/缩放后悬浮菜单的定位会失效，直接隐藏（下次点击会重新按新位置定位）
  mainWindow.on('move', () => avatarMenuWindow.hideMenu());
  mainWindow.on('resize', () => avatarMenuWindow.hideMenu());

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
    webviewManager.closeWebview();
    avatarMenuWindow.hideMenu();
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

// ===== URL Scheme 唤起处理 =====

// 注册 wemeetsdk:// 协议（开发模式生效；打包后由 electron-builder protocols 配置注册）
app.setAsDefaultProtocolClient(SCHEME_NAME);

/**
 * 从 argv 中提取 wemeetsdk:// scheme URL
 * Windows 下通过 scheme 唤起应用时，URL 作为命令行参数传入
 * @param {string[]} argv
 * @returns {string|null}
 */
function getSchemeUrlFromArgv(argv) {
  const prefix = `${SCHEME_NAME}://`;
  if (!Array.isArray(argv)) return null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg === 'string' && arg.startsWith(prefix)) {
      return arg;
    }
  }
  return null;
}

/**
 * 处理 scheme 唤起 URL 的统一入口
 * - SDK 已登录：直接调用 SDK HandleSchema 入会
 * - SDK 未登录：暂存 URL，待 OnLogin 成功回调中再处理
 *
 * 同时尝试把主窗口提到前台，避免在后台被唤起。
 *
 * @param {string} url - 完整的 wemeetsdk:// URL
 */
async function handleSchemeUrl(url) {
  console.log('[Scheme] 收到 scheme URL:', url);
  if (!url || !url.startsWith(`${SCHEME_NAME}://`)) {
    console.warn('[Scheme] URL 与协议不匹配，已忽略:', url);
    return;
  }

  // 把主窗口提到前台
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } catch (err) {
      console.warn('[Scheme] 提升窗口前台失败:', err.message);
    }
  }

  // SDK 已登录：直接处理
  if (wemeetSdkModule.isSdkLoggedIn()) {
    pendingSchemeUrl = null;
    await wemeetSdkModule.handleScheme(url);
    return;
  }

  // SDK 未登录：暂存 URL，等待 OnLogin 成功后再处理
  // 注意：用户可能未登录账号，此时需要显示登录页让用户手动登录，
  // OnLogin 回调中会自动处理暂存的 URL
  pendingSchemeUrl = url;
  console.log('[Scheme] SDK 未登录，URL 已暂存，待登录成功后处理');

  // 若已有有效 token，触发自动登录（ensureSDKLoggedIn 会刷新 token 并登录 SDK）
  if (!tokenStore.isAccessTokenExpired()) {
    const tokens = tokenStore.getTokens();
    if (tokens) {
      console.log('[Scheme] 检测到有效 token，触发 SDK 自动登录');
      wemeetSdkModule.ensureSDKLoggedIn().then((ok) => {
        if (ok) {
          console.log('[Scheme] 自动登录成功，挂起的 URL 将在 OnLogin 回调中处理');
        } else {
          console.warn('[Scheme] 自动登录失败，等待用户手动登录');
        }
      }).catch((err) => {
        console.error('[Scheme] 自动登录异常:', err.message);
      });
    }
  }
}

// macOS：scheme 唤起（冷启动时此事件可能在 app.whenReady 之前触发）
app.on('open-url', (event, url) => {
  event.preventDefault();
  console.log('[Scheme] open-url 事件:', url);
  if (!app.isReady()) {
    // 应用未就绪：先暂存 URL，待 whenReady 后处理
    pendingSchemeUrl = url;
    return;
  }
  handleSchemeUrl(url).catch((err) => {
    console.error('[Scheme] open-url 处理失败:', err.message);
  });
});

// Windows：单实例锁，确保只有一个应用实例运行
// 第二个实例启动时（通常通过 scheme 唤起），将 URL 转发给主实例
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  // 已有实例在运行，当前实例直接退出（URL 会通过 second-instance 转发到主实例）
  console.log('[Scheme] 已有实例运行，当前实例退出');
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    console.log('[Scheme] second-instance 事件，命令行:', commandLine);
    const url = getSchemeUrlFromArgv(commandLine);
    if (url) {
      handleSchemeUrl(url).catch((err) => {
        console.error('[Scheme] second-instance 处理失败:', err.message);
      });
    } else {
      // 非 scheme 唤起，仅把窗口提到前台
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (!mainWindow.isVisible()) mainWindow.show();
          mainWindow.focus();
        } catch {}
      }
    }
  });
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
    handleScheme: wemeetSdkModule.handleScheme,
    getPendingSchemeUrl: () => pendingSchemeUrl,
    consumePendingSchemeUrl: () => {
      const url = pendingSchemeUrl;
      pendingSchemeUrl = null;
      return url;
    },
    // Webview 嵌入网页
    createWebview: webviewManager.createWebview,
    resizeWebview: webviewManager.resizeWebview,
    closeWebview: webviewManager.closeWebview,
    hideWebview: webviewManager.hideWebview,
    showWebview: webviewManager.showWebview,
    getWebviewInfo: webviewManager.getWebviewInfo,
    webviewGoBack: webviewManager.goBack,
    webviewGoForward: webviewManager.goForward,
    webviewReload: webviewManager.reload,
    // 多 webview 扩展（企业 SSO 动态页签）
    closeWebviewById: webviewManager.closeWebviewById,
    closeAllWebviews: webviewManager.closeAllWebviews,
    hideWebviewAll: webviewManager.hideWebviewAll,
    showActiveWebview: webviewManager.showActiveWebview,
    setActiveWebview: webviewManager.setActive,
    listWebviews: webviewManager.listWebviews,
    webviewManagerAPI: webviewManager,
    // 头像菜单悬浮窗
    avatarMenuWindowAPI: avatarMenuWindow,
  });

  // 冷启动：检查 Windows 通过命令行参数传入的 scheme URL
  const coldStartUrl = getSchemeUrlFromArgv(process.argv);
  if (coldStartUrl) {
    console.log('[Scheme] 检测到冷启动 scheme URL:', coldStartUrl);
    pendingSchemeUrl = coldStartUrl;
  }

  // 处理 macOS 在 whenReady 之前已通过 open-url 暂存的 URL
  if (pendingSchemeUrl) {
    console.log('[Scheme] 应用就绪，尝试处理 pending scheme URL');
    handleSchemeUrl(pendingSchemeUrl).catch((err) => {
      console.error('[Scheme] 处理失败:', err.message);
    });
  }
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
