'use strict';

if (process.platform === 'linux' && process.arch === 'arm64') {
  require('./platform/linux-arm64/main').start();
} else {
  require('./main-darwin-win32');
}
