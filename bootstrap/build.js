// 统一构建入口：注入 BUILD_DATE 环境变量后调用 electron-builder
// 用法: node bootstrap/build.js [electron-builder 参数...]
//   --arm64 / --x64   指定目标架构（注入 TMSDK_ARCH 供 after-pack.js 选择单架构 Framework）
//   环境变量 SKIP_SIGN=1 可跳过签名
//
// macOS 打包流程（Framework 拷贝 + 签名均在 after-pack.js 中执行）：
//   electron-builder 打包 → afterPack: 拷贝 Framework + codesign → 构建 DMG
//   （签名在 DMG 构建之前完成，确保 DMG 内是已签名 .app）
const { spawn } = require('child_process');

const now = new Date();
const date =
  now.getFullYear().toString() +
  String(now.getMonth() + 1).padStart(2, '0') +
  String(now.getDate()).padStart(2, '0');

process.env.BUILD_DATE = date;

const args = process.argv.slice(2);

// 注入目标架构，after-pack.js 据此从 wemeet_sdk/mac/Frameworks/<arch>/ 选择单架构 Framework
if (args.some((a) => a.includes('arm64'))) {
  process.env.TMSDK_ARCH = 'arm64';
} else if (args.some((a) => a.includes('x64'))) {
  process.env.TMSDK_ARCH = 'x64';
}

// 禁用 electron-builder 内置签名：
//  1. 6000+ 文件的 framework 会触发其内部签名器 EMFILE
//  2. 签名逻辑已移至 after-pack.js（时机更早，DMG 构建前）
if (process.platform === 'darwin') {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}

const child = spawn('electron-builder', args, {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

child.on('close', (code) => process.exit(code || 0));
