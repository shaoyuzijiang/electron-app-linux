/**
 * 「关于」对话框窗口
 *
 * 为什么不用原生 dialog.showMessageBox：
 *   macOS 上原生对话框的图标取自当前进程所属的 App——开发模式（npm run dev）
 *   运行的是 node_modules 里的 Electron.app，图标永远是 Electron 默认logo，
 *   且 macOS 的 dialog 不支持自定义 icon 参数。改用自定义无边框窗口。
 *
 * logo 加载方式：
 *   electron-builder 会把被 extraResources/icon 引用的源文件（renderer/assets/app.png）
 *   排除出 asar，因此页面不能依赖 asar 内的相对路径引用。这里由主进程计算图标
 *   真实文件的绝对路径（dev: renderer/assets/；打包后: Resources/app.png，来自
 *   extraResources），转成 file:// URL 通过 query 注入页面。
 *
 * 交互：
 *   - 模态子窗口（parent 为主窗口），点击 ✕ / Esc / 失焦自动关闭
 *   - 版本信息通过 URL query 传给页面，避免额外 IPC
 *   - 更新检查/下载通过 preload 暴露的 IPC（utils/updater.js）；
 *     下载进行中失焦不自动关闭（进度在窗口内展示，切走再回来仍可见）
 */
const { BrowserWindow, app } = require('electron');
const path = require('path');
const url = require('url');

let aboutWindow = null;
// 下载进行中标记（由 ipc-handlers 通过 setDownloading 更新）
let downloading = false;

// 图标真实文件路径（与 sdk_mgmt/wemeet-sdk.js 的 appIconPath 同源）
function getLogoFileUrl() {
  const logoPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.png')
    : path.join(__dirname, '..', 'renderer', 'assets', 'app.png');
  return url.pathToFileURL(logoPath).href;
}

/**
 * 显示「关于」对话框（已打开则置前）
 * @param {BrowserWindow|null} mainWindow - 主窗口引用
 * @param {{appName:string, appVersion:string, sdkVersion:string|null}} info - 版本信息
 */
function showAboutDialog(mainWindow, info) {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }

  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

  aboutWindow = new BrowserWindow({
    width: 360,
    height: 460,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    parent,
    modal: !!parent, // macOS 模态：主窗口不可交互，直到关闭
    webPreferences: {
      preload: path.join(__dirname, '..', 'bootstrap', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  aboutWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  aboutWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let targetPath = '';
    try { targetPath = new URL(targetUrl).pathname; } catch {}
    if (targetPath !== new URL(url.pathToFileURL(path.join(__dirname, '..', 'renderer', 'about-dialog.html')).href).pathname) event.preventDefault();
  });
  aboutWindow.webContents.on('will-redirect', (event) => event.preventDefault());
  aboutWindow.once('ready-to-show', () => {
    if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.show();
  });

  // 失焦自动关闭（下载进行中不关闭，避免丢失下载进度显示）
  aboutWindow.on('blur', () => {
    if (downloading) return;
    if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.close();
  });

  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });

  aboutWindow.loadFile(path.join(__dirname, '..', 'renderer', 'about-dialog.html'), {
    query: {
      appName: info.appName || '',
      appVersion: info.appVersion || '',
      sdkVersion: info.sdkVersion || '',
      runtimePlatform: process.platform,
      logo: getLogoFileUrl(),
    },
  });
}

function closeAboutDialog() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.close();
  }
}

function getAboutWindow() {
  return aboutWindow && !aboutWindow.isDestroyed() ? aboutWindow : null;
}

function setAboutDownloading(isDownloading) {
  downloading = !!isDownloading;
}

module.exports = {
  showAboutDialog,
  closeAboutDialog,
  getAboutWindow,
  setAboutDownloading,
};
