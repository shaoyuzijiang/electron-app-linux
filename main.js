'use strict';

// Linux ARM64 与 x86_64 共用同一 adapter（纯 JS，无架构假设）；
// 目录名 linux-arm64 为历史遗留，x64 链路复用（见 docs/X86_LINUX_SUPPORT_PLAN.md）。
if (process.platform === 'linux' && (process.arch === 'arm64' || process.arch === 'x64')) {
  require('./platform/linux-arm64/main').start();
} else {
  require('./main-darwin-win32');
}
