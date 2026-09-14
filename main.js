'use strict';

const { app } = require('electron');
const { createMainWindow } = require('./src/main/window-manager');
const { registerIpc } = require('./src/main/ipc/register-ipc');
const { SdkService } = require('./src/main/sdk/sdk-service');
const { createLogger } = require('./src/main/logging/logger');

const logger = createLogger();
const mockEnabled = !app.isPackaged && process.env.MEETING_DEMO_MOCK === '1';
const sdkService = new SdkService({ mockEnabled, logger, isPackaged: app.isPackaged });
let mainWindow;

app.whenReady().then(async () => {
  mainWindow = createMainWindow();
  registerIpc({ sdkService, getMainWindow: () => mainWindow });

  try {
    await sdkService.prepare();
  } catch (error) {
    logger.error('SDK 运行环境准备失败', error);
  }

  app.on('activate', () => {
    if (mainWindow === null) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  sdkService.dispose().catch((error) => logger.error('SDK 清理失败', error));
});
