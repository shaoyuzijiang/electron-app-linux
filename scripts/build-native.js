'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { stageRuntime } = require('./stage-sdk');

const projectRoot = path.resolve(__dirname, '..');

function main() {
  if (process.platform !== 'linux' || process.arch !== 'arm64') {
    throw new Error(`原生构建只能在 linux/arm64 执行；当前为 ${process.platform}/${process.arch}`);
  }
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    '--no-install', 'node-gyp', 'rebuild', '--target=33.4.11', '--arch=arm64', '--dist-url=https://electronjs.org/headers'
  ], { cwd: projectRoot, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`node-gyp 构建失败，退出码：${result.status}`);
  const addonPath = path.join(projectRoot, 'build', 'Release', 'wemeet_electron_sdk.node');
  if (!fs.existsSync(addonPath)) throw new Error(`未找到构建产物：${addonPath}`);
  stageRuntime({ addonSource: addonPath });
}

try {
  main();
} catch (error) {
  console.error(`原生构建失败：${error.message}`);
  process.exitCode = 1;
}
