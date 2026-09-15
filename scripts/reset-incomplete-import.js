'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SDK_VERSION } = require('./sdk-utils');

const projectRoot = path.resolve(__dirname, '..');
const sdkRoot = path.join(projectRoot, 'sdk', 'linux-arm64', SDK_VERSION);
const nativeRoot = path.join(projectRoot, 'native');
const completeNativeFiles = ['wemeet.cpp', 'jsoncpp.cpp', 'json/json.h', 'json/json-forwards.h'];

function existsCompleteImport() {
  return completeNativeFiles.every((relativePath) => fs.existsSync(path.join(nativeRoot, relativePath)))
    && fs.existsSync(path.join(sdkRoot, 'sdk-manifest.json'));
}

function main() {
  if (!process.argv.includes('--confirm')) {
    throw new Error('此命令只清理旧版不完整导入。确认后请使用：npm run sdk:reset-incomplete -- --confirm');
  }
  if (existsCompleteImport()) {
    throw new Error('检测到完整导入，拒绝清理。请使用 npm run sdk:verify 验证，不要重新导入。');
  }
  if (!fs.existsSync(sdkRoot) && !fs.existsSync(nativeRoot)) {
    console.info('未发现旧版导入残留，无需清理。');
    return;
  }
  const nativeEntries = fs.existsSync(nativeRoot) ? fs.readdirSync(nativeRoot) : [];
  if (nativeEntries.some((entry) => !['wemeet.cpp', '.gitkeep'].includes(entry))) {
    throw new Error('native/ 包含未知文件，拒绝自动清理。请人工核查后再处理。');
  }
  if (fs.existsSync(sdkRoot)) fs.rmSync(sdkRoot, { recursive: true, force: true });
  if (fs.existsSync(nativeRoot)) fs.rmSync(nativeRoot, { recursive: true, force: true });
  console.info('已清理旧版不完整 SDK 导入残留；现在可重新运行 npm run sdk:import。');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`旧版导入残留清理失败：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { existsCompleteImport };
