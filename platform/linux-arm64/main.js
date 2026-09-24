'use strict';

const fs = require('fs');
const path = require('path');
const { configureGraphicsEnvironment } = require('./graphics-env');

function resolveSdkRoot(projectRoot) {
  const installed = path.join(path.dirname(process.execPath), 'resources', 'wemeet-sdk', 'linux');
  return fs.existsSync(installed) ? installed : path.join(projectRoot, 'output', 'linux');
}

function start() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const bootTrace = (step) => {
    if (process.env.WEMEET_BOOT_TRACE !== '0') console.log(`[Boot] ${step}`);
  };
  process.on('uncaughtException', (error) => console.error('[Boot] 未捕获异常:', error));
  process.on('unhandledRejection', (reason) => console.error('[Boot] 未处理的 Promise 拒绝:', reason));
  bootTrace('start: 配置图形环境前');
  const graphics = configureGraphicsEnvironment({ sdkRoot: resolveSdkRoot(projectRoot) });
  bootTrace('start: 配置图形环境后');
  if (graphics.reason === 'missing') {
    console.warn(`[Graphics] Wayland 会话未找到系统 Mesa 补丁 ${graphics.patchPath}`);
  } else if (graphics.reason === 'failed') {
    console.warn(`[Graphics] 加载系统 Mesa 补丁失败: ${graphics.error}`);
  } else if (graphics.applied) {
    console.log(`[Graphics] 已加载系统 Mesa 补丁: ${graphics.patchPath}`);
  }

  const { app, BrowserWindow, ipcMain, session, powerMonitor } = require('electron');
  const logger = require('../../utils/logger');
  const api = require('../../backend_api/api');
  const httpClient = require('../../backend_api/httpClient');
  const appSettings = require('../../utils/app-settings');
  const tokenStore = require('../../utils/token-store');
  const meetingPolling = require('../../backend_api/meeting-polling');
  const { createLinuxSdkAdapter } = require('./sdk-adapter');
  const { registerLinuxIpc } = require('./ipc');

  app.commandLine.appendSwitch('ozone-platform', 'x11');
  // 麒麟 Mali/Mesa 栈上 Electron GPU 进程初始化会失败并反复重启。
  // 会议视频渲染在 SDK 独立 Qt 进程（tmsdkapp）中，不依赖 Electron GPU；
  // Electron 仅承载业务 UI，禁用 GPU 走内置 SwiftShader 软件渲染即可。
  app.commandLine.appendSwitch('disable-gpu');

  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  let mainWindow = null;
  let refreshFlight = null;
  let authGeneration = 0;
  let quitReady = false;
  let resumeTimer = null;
  let pendingSchemeUrl = null;

  const SCHEME_PREFIX = 'wemeetsdk://';
  function getSchemeUrlFromArgv(argv) {
    if (!Array.isArray(argv)) return null;
    for (let i = 1; i < argv.length; i++) {
      if (typeof argv[i] === 'string' && argv[i].startsWith(SCHEME_PREFIX)) return argv[i];
    }
    return null;
  }
  async function handleSchemeUrl(url) {
    if (!url || !url.startsWith(SCHEME_PREFIX)) return;
    focusMainWindow();
    if (adapter.getStatus().loggedIn) {
      pendingSchemeUrl = null;
      try { adapter.requireMethod('HandleSchema')(url); }
      catch (err) { console.error('[Scheme] 处理失败:', err.message); }
      return;
    }
    pendingSchemeUrl = url;
    console.log('[Scheme] SDK 未登录，URL 已暂存，待登录成功后处理');
  }

  function getMainWindow() { return mainWindow; }
  function beginAuthOperation() { authGeneration += 1; return authGeneration; }
  function invalidateAuth() { authGeneration += 1; return authGeneration; }
  function isAuthOperationCurrent(generation) { return generation === authGeneration; }
  function appIconPath() {
    const installed = path.join(path.dirname(process.execPath), 'resources', 'app.png');
    return fs.existsSync(installed) ? installed : path.join(__dirname, '..', '..', 'renderer', 'assets', 'app.png');
  }
  function showPage(page) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', page === 'main' ? 'index.html' : 'login.html'));
  }
  function focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  const adapter = createLinuxSdkAdapter({ app, api, projectRoot });

  async function getValidAccessToken() {
    const current = tokenStore.getTokens();
    if (!current) throw new Error('未登录');
    if (!tokenStore.isAccessTokenExpired()) return current.accessToken;
    if (!current.refreshToken) {
      tokenStore.clearTokens();
      throw new Error('登录已过期，请重新登录');
    }
    if (refreshFlight) return refreshFlight;
    const generation = authGeneration;
    const refreshToken = current.refreshToken;
    refreshFlight = (async () => {
      try {
        const refreshed = await api.refreshToken(refreshToken);
        const latest = tokenStore.getTokens();
        if (!isAuthOperationCurrent(generation) || !latest || latest.refreshToken !== refreshToken) throw new Error('认证操作已取消');
        tokenStore.saveTokens(refreshed);
        return refreshed.accessToken;
      } catch (error) {
        if (isAuthOperationCurrent(generation)) {
          tokenStore.clearTokens();
          adapter.cancelSession().catch(() => {});
          showPage('login');
        }
        throw new Error(`登录已过期，请重新登录：${error.message}`);
      } finally { refreshFlight = null; }
    })();
    return refreshFlight;
  }

  adapter.setAccessTokenProvider(getValidAccessToken);
  meetingPolling.init({
    getValidAccessToken,
    getMainWindow,
    isSdkLoggedIn: () => adapter.getStatus().loggedIn,
    instanceId: 10,
  });
  adapter.events.on('callback', ({ func, success }) => {
    if (func === 'OnLogin' && success) {
      meetingPolling.startMeetingListPolling();
      meetingPolling.scheduleMeetingListRefresh();
    } else if (['OnLogout', 'OnSDKUninitializeResult', 'OnSDKError', 'OnResetSDKState'].includes(func)) {
      meetingPolling.stopMeetingListPolling();
    } else if (func === 'OnJoinMeeting' || func === 'OnLeaveMeeting') {
      meetingPolling.scheduleMeetingListRefresh();
    }
  });

  function restoreSession() {
    if (!tokenStore.getTokens()) return;
    const generation = beginAuthOperation();
    getValidAccessToken()
      .then(() => adapter.activateSession(false))
      .then(() => {
        if (!isAuthOperationCurrent(generation)) return;
        showPage('main');
        return adapter.ensureLoggedIn(getValidAccessToken);
      })
      .catch(() => {
        if (isAuthOperationCurrent(generation)) {
          tokenStore.clearTokens();
          showPage('login');
        }
      });
  }

  function lockNavigation(webContents) {
    const allowed = new Set(['login.html', 'index.html'].map((file) => new URL(`file://${path.join(__dirname, '..', '..', 'renderer', file)}`).href));
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    webContents.on('will-navigate', (event, targetUrl) => { if (!allowed.has(targetUrl)) event.preventDefault(); });
    webContents.on('will-redirect', (event) => event.preventDefault());
  }

  function createWindow() {
    bootTrace('createWindow: 开始创建主窗口');
    mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 800,
      minHeight: 600,
      title: '腾讯会议 SDK Demo',
      icon: appIconPath(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'bootstrap', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments: [`--is-dev=${app.isPackaged ? '0' : '1'}`, '--runtime-platform=linux-arm64'],
      },
    });
    mainWindow.setMenu(null);
    lockNavigation(mainWindow.webContents);
    mainWindow.webContents.on('did-finish-load', () => bootTrace('渲染进程: 页面加载完成'));
    mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) =>
      console.error(`[Boot] 渲染进程: 页面加载失败 code=${code} ${desc} ${url}`));
    mainWindow.webContents.on('render-process-gone', (_event, details) =>
      console.error(`[Boot] 渲染进程退出: ${details.reason} exitCode=${details.exitCode}`));
    mainWindow.webContents.on('unresponsive', () => console.error('[Boot] 渲染进程无响应'));
    adapter.setRendererSender((channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
      meetingPolling.stopMeetingListPolling();
    });
    mainWindow.on('restore', () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (tokenStore.getTokens()) adapter.ensureLoggedIn(getValidAccessToken).catch(() => {});
      }, 3000);
    });
    showPage('login');
    bootTrace('createWindow: 登录页已加载');
    restoreSession();
  }

  if (!hasSingleInstanceLock) {
    app.exit(0);
    return;
  }
  app.on('second-instance', (_event, commandLine) => {
    focusMainWindow();
    const url = getSchemeUrlFromArgv(commandLine);
    if (url) handleSchemeUrl(url).catch((err) => console.error('[Scheme] 处理失败:', err.message));
  });
  app.whenReady().then(async () => {
    bootTrace('whenReady: 进入');
    logger.install();
    bootTrace('whenReady: logger 完成');
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    bootTrace('whenReady: session 钩子完成');
    httpClient.updateBaseUrl(appSettings.getBaseUrl());
    bootTrace('whenReady: 服务端地址就绪');

    // 窗口是用户可见的关键路径，最先创建；IPC 处理器在同一事件循环内
    // 紧随其后注册，仍早于渲染进程首次 invoke。
    createWindow();
    bootTrace('whenReady: 主窗口创建完成');

    try {
      const { registerBackendHandlers } = require('./backend-handlers');
      registerBackendHandlers({
        ipcMain, shell: require('electron').shell, app, api, logger,
        getMainWindow, getValidAccessToken,
      });
      bootTrace('whenReady: 后端 IPC 注册完成');
    } catch (error) {
      console.error('[Boot] 后端 IPC 注册失败（IM/日程/通讯录暂不可用，会议不受影响）:', error);
    }

    registerLinuxIpc({
      ipcMain, app, api, adapter, tokenStore, appSettings, httpClient,
      getMainWindow, showPage, getValidAccessToken, beginAuthOperation, invalidateAuth, isAuthOperationCurrent,
      refreshMeetingList: meetingPolling.scheduleMeetingListRefresh, stopMeetingPolling: meetingPolling.stopMeetingListPolling,
      appRoot: path.resolve(__dirname, '..', '..'),
      handleScheme: handleSchemeUrl,
      getPendingSchemeUrl: () => ({ success: true, url: pendingSchemeUrl }),
      consumePendingSchemeUrl: () => {
        const url = pendingSchemeUrl;
        pendingSchemeUrl = null;
        return { success: true, url };
      },
    });
    bootTrace('whenReady: 会议 IPC 注册完成');

    await adapter.load();
    bootTrace('whenReady: SDK addon 加载流程结束');
    api.prefetchPublicKey();
    bootTrace('whenReady: 全部启动步骤完成');

    // SDK 登录成功后处理挂起的 scheme URL（冷启动唤起场景）
    adapter.events.on('callback', ({ func, success }) => {
      if (func === 'OnLogin' && success && pendingSchemeUrl) {
        const url = pendingSchemeUrl;
        pendingSchemeUrl = null;
        console.log('[Scheme] SDK 登录成功，处理挂起的 scheme URL');
        try { adapter.requireMethod('HandleSchema')(url); }
        catch (err) { console.error('[Scheme] 处理失败:', err.message); }
      }
    });

    const coldStartUrl = getSchemeUrlFromArgv(process.argv);
    if (coldStartUrl) {
      console.log('[Scheme] 检测到冷启动 scheme URL');
      pendingSchemeUrl = coldStartUrl;
    }
    powerMonitor.on('resume', () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (tokenStore.getTokens() && !quitReady) adapter.ensureLoggedIn(getValidAccessToken).catch(() => {});
      }, 3000);
    });
  }).catch((error) => {
    console.error('[Boot] 启动流程异常:', error);
  });
  app.on('before-quit', (event) => {
    if (quitReady) return;
    event.preventDefault();
    quitReady = true;
    meetingPolling.stopMeetingListPolling();
    if (resumeTimer) clearTimeout(resumeTimer);
    adapter.cancelSession().catch(() => {}).finally(() => app.quit());
  });
}

module.exports = { start };
