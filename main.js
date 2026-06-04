const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const api = require('./api');
const tokenStore = require('./token-store');

let mainWindow;

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

  // 登录
  ipcMain.handle('login', async (_event, { username, password }) => {
    try {
      const tokenData = await api.login(username, password);
      tokenStore.saveTokens(tokenData);

      // 获取用户信息
      const profile = await api.getProfile(tokenData.accessToken);

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
      const tokens = tokenStore.getTokens();
      if (!tokens) {
        return { success: false, message: '未登录' };
      }

      // 如果 accessToken 过期，先刷新
      if (tokenStore.isAccessTokenExpired()) {
        try {
          const newTokenData = await api.refreshToken(tokens.refreshToken);
          tokenStore.saveTokens(newTokenData);
          const profile = await api.getProfile(newTokenData.accessToken);
          return { success: true, profile };
        } catch {
          tokenStore.clearTokens();
          return { success: false, message: '登录已过期，请重新登录' };
        }
      }

      const profile = await api.getProfile(tokens.accessToken);
      return { success: true, profile };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // 退出登录
  ipcMain.handle('logout', async () => {
    tokenStore.clearTokens();
    if (mainWindow) {
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
    }
    return { success: true };
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
