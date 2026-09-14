'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rendererEntryUrl = pathToFileURL(path.resolve(__dirname, '../../renderer/index.html')).toString();

function assertTrustedSender(event) {
  const { senderFrame, sender } = event;
  if (!senderFrame || senderFrame !== sender.mainFrame || senderFrame.url !== rendererEntryUrl) {
    throw new Error('拒绝来自非受信任渲染进程的 IPC 请求');
  }
}

module.exports = { assertTrustedSender };
