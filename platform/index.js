'use strict';

function getPlatformCapabilities(platform = process.platform, arch = process.arch) {
  if (platform === 'linux' && arch === 'arm64') {
    return require('./linux-arm64/capabilities');
  }
  if (platform === 'darwin' || platform === 'win32') {
    return require('./darwin-win32/capabilities');
  }
  throw new Error(`未支持的平台：${platform}/${arch}`);
}

module.exports = { getPlatformCapabilities };
