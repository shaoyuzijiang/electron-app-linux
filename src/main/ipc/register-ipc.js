'use strict';

const { ipcMain } = require('electron');
const { assertTrustedSender } = require('./validate-sender');
const { validateInit, validateJoinMeeting, validateLogin } = require('./schemas');

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, input) => {
    assertTrustedSender(event);
    return handler(input);
  });
}

function registerIpc({ sdkService, getMainWindow }) {
  handle('demo:get-snapshot', () => sdkService.getSnapshot());
  handle('demo:initialize', (input) => sdkService.initialize(validateInit(input)));
  handle('demo:login', (input) => sdkService.login(validateLogin(input)));
  handle('demo:join-meeting', (input) => sdkService.joinMeeting(validateJoinMeeting(input)));
  handle('demo:leave-meeting', () => sdkService.leaveMeeting());
  handle('demo:logout', () => sdkService.logout());
  handle('demo:uninitialize', () => sdkService.uninitialize());

  sdkService.on('update', (snapshot) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('demo:update', snapshot);
  });
}

module.exports = { registerIpc };
