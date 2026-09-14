'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SDK_VERSION, assertArm64Elf, assertSafeSymlinks, copyPreservingLinks } = require('./sdk-utils');

const projectRoot = path.resolve(__dirname, '..');
const sdkRoot = path.join(projectRoot, 'sdk', 'linux-arm64', SDK_VERSION);
const runtimeRoot = path.join(projectRoot, 'output', 'linux-arm64');
const usePrebuilt = process.argv.includes('--use-prebuilt');

function stageRuntime({ addonSource } = {}) {
  const selectedAddon = addonSource || (usePrebuilt
    ? path.join(sdkRoot, 'prebuilt', 'wemeet_electron_sdk.node')
    : path.join(runtimeRoot, 'wemeet_electron_sdk.node'));
  if (!fs.existsSync(selectedAddon)) {
    throw new Error(usePrebuilt ? '官方预编译 addon 不存在' : '缺少重新编译的 addon；请先在 Linux ARM64 执行 npm run build:native:linux-arm64');
  }
  assertArm64Elf(selectedAddon);
  const stagingParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tmsdk-stage-'));
  const stagingRoot = path.join(stagingParent, 'linux-arm64');
  try {
    fs.mkdirSync(stagingRoot, { recursive: true });
    fs.copyFileSync(selectedAddon, path.join(stagingRoot, 'wemeet_electron_sdk.node'), fs.constants.COPYFILE_EXCL);
    fs.chmodSync(path.join(stagingRoot, 'wemeet_electron_sdk.node'), fs.statSync(selectedAddon).mode);
    for (const filename of ['libwemeetsdk.so', 'libwemeet_base.so', 'saas_sdk_env.json']) {
      fs.copyFileSync(path.join(sdkRoot, filename), path.join(stagingRoot, filename), fs.constants.COPYFILE_EXCL);
      fs.chmodSync(path.join(stagingRoot, filename), fs.statSync(path.join(sdkRoot, filename)).mode);
    }
    copyPreservingLinks(path.join(sdkRoot, 'Release'), path.join(stagingRoot, 'Release'));
    assertSafeSymlinks(stagingRoot);
    fs.mkdirSync(path.dirname(runtimeRoot), { recursive: true });
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.renameSync(stagingRoot, runtimeRoot);
    console.info(`SDK 运行时已暂存至 ${runtimeRoot}${usePrebuilt ? '（官方预编译 addon，仅排障用途）' : ''}`);
  } finally {
    fs.rmSync(stagingParent, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    stageRuntime();
  } catch (error) {
    console.error(`SDK 暂存失败：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { stageRuntime };
