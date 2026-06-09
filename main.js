const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const api = require('./api');
const tokenStore = require('./token-store');

let mainWindow;

/**
 * 获取有效的 accessToken，如果已过期则自动刷新
 * @returns {string} 有效的 accessToken
 * @throws {Error} 未登录或刷新失败
 */
async function getValidAccessToken() {
  const tokens = tokenStore.getTokens();
  if (!tokens) {
    throw new Error('未登录');
  }

  if (!tokenStore.isAccessTokenExpired()) {
    return tokens.accessToken;
  }

  // accessToken 已过期，尝试刷新
  const newTokenData = await api.refreshToken(tokens.refreshToken);
  tokenStore.saveTokens(newTokenData);
  return newTokenData.accessToken;
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
}

app.whenReady().then(() => {
  createWindow();

  // 应用启动时获取 SDK Token（非阻塞，不影响 IPC 注册）
  api.getSdkToken()
    .then((sdkData) => {
      tokenStore.saveSdkToken(sdkData);
      console.log('SDK Token 获取成功');
    })
    .catch((err) => {
      console.error('获取 SDK Token 失败:', err.message);
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
        tokenStore.saveIdToken(idTokenData);
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
    tokenStore.clearTokens();
    tokenStore.clearMeetingTokens();
    if (mainWindow) {
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
    }
    return { success: true };
  });

  // 获取 SDK Token 数据（首页使用）
  ipcMain.handle('get-sdk-token', () => {
    return tokenStore.getSdkToken() || null;
  });

  // 获取 ID Token 数据（首页使用）
  ipcMain.handle('get-id-token', () => {
    return tokenStore.getIdToken() || null;
  });

  // 重新获取 ID Token（首页重试，需确保已登录且 token 有效）
  ipcMain.handle('fetch-id-token', async () => {
    try {
      const accessToken = await getValidAccessToken();
      const idTokenData = await api.getIdToken(accessToken);
      tokenStore.saveIdToken(idTokenData);
      return idTokenData;
    } catch (err) {
      tokenStore.saveIdToken({ error: err.message });
      return { error: err.message };
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
