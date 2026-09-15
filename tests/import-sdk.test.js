'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSdkExtractionPlan } = require('../scripts/sdk-utils');
const { assertImportTargetsAvailable, commitPreparedImport, extractArchive, runTar } = require('../scripts/import-sdk');

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmsdk-import-test-'));
  try { return callback(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function archivePlan() {
  const root = 'TMSDK_0300000000_3.26.100.14_arm64_default.publish';
  return createSdkExtractionPlan([
    `${root}/SDK/include/`,
    `${root}/SDK/include/wemeet_sdk.h`,
    `${root}/SDK/Release/`,
    `${root}/SDK/Release/plugins/iconengines/libqsvgicon.so`,
    `${root}/SDK/libwemeetsdk.so`,
    `${root}/SDK/libwemeet_base.so`,
    `${root}/SDK/saas_sdk_env.json`,
    `${root}/Electron_Demo/wemeet_sdk/wemeet.cpp`,
    `${root}/Electron_Demo/output/linux/wemeet_electron_sdk.node`
  ], root);
}

test('实际 tar 调用只使用顶层提取项，不混入 Release 子成员', () => withTempDirectory((directory) => {
  const calls = [];
  extractArchive({
    packagePath: path.join(directory, 'fixture.tar.gz'),
    tempRoot: directory,
    plan: archivePlan(),
    runTarImpl: (argumentsList) => { calls.push(argumentsList); return ''; }
  });
  assert.equal(calls.length, 1);
  const argumentsList = calls[0];
  assert.equal(argumentsList.includes('TMSDK_0300000000_3.26.100.14_arm64_default.publish/SDK/Release/plugins/iconengines/libqsvgicon.so'), false);
  assert.equal(argumentsList.filter((item) => item.includes('/SDK/Release')).length, 1);
  assert.equal(argumentsList.filter((item) => item.includes('/SDK/include')).length, 1);
}));

test('小型 tar fixture 只传顶层目录也能提取 Release 子资源', () => withTempDirectory((directory) => {
  const root = 'TMSDK_0300000000_3.26.100.14_arm64_default.publish';
  const sourceRoot = path.join(directory, root);
  const archivePath = path.join(directory, 'fixture.tar.gz');
  const extractionRoot = path.join(directory, 'extracted');
  const files = [
    'SDK/include/wemeet_sdk.h',
    'SDK/Release/plugins/iconengines/libqsvgicon.so',
    'SDK/libwemeetsdk.so',
    'SDK/libwemeet_base.so',
    'SDK/saas_sdk_env.json',
    'Electron_Demo/wemeet_sdk/wemeet.cpp',
    'Electron_Demo/output/linux/wemeet_electron_sdk.node'
  ];
  for (const relativePath of files) {
    const filePath = path.join(sourceRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'fixture');
  }
  const createArchive = spawnSync('tar', ['-czf', archivePath, root], { cwd: directory, encoding: 'utf8' });
  assert.equal(createArchive.status, 0, createArchive.stderr);
  const listArchive = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8' });
  assert.equal(listArchive.status, 0, listArchive.stderr);
  const plan = createSdkExtractionPlan(listArchive.stdout.split(/\r?\n/).filter(Boolean), root);
  fs.mkdirSync(extractionRoot);
  extractArchive({ packagePath: archivePath, tempRoot: extractionRoot, plan });
  assert.equal(fs.existsSync(path.join(extractionRoot, root, 'SDK', 'Release', 'plugins', 'iconengines', 'libqsvgicon.so')), true);
}));

test('tar 启动级错误保留原始原因', () => {
  assert.throws(() => runTar(['-tzf', 'fixture.tar.gz'], () => ({ error: new Error('E2BIG') })), /无法启动 tar：E2BIG/);
});

test('提交阶段失败会清理本次 SDK 和 bridge 半成品并恢复占位目录', () => withTempDirectory((directory) => {
  const preparedSdk = path.join(directory, 'prepared-sdk');
  const preparedBridge = path.join(directory, 'prepared-wemeet.cpp');
  const sdkDestination = path.join(directory, 'sdk', 'linux-arm64', '3.26.100.14');
  const nativeDestination = path.join(directory, 'native', 'wemeet.cpp');
  fs.mkdirSync(preparedSdk, { recursive: true });
  fs.writeFileSync(path.join(preparedSdk, 'marker'), 'prepared');
  fs.writeFileSync(preparedBridge, 'prepared bridge');
  fs.mkdirSync(sdkDestination, { recursive: true });
  fs.writeFileSync(path.join(sdkDestination, '.gitkeep'), '');
  let moves = 0;
  assert.throws(() => commitPreparedImport({
    preparedSdk,
    preparedBridge,
    sdkDestination,
    nativeDestination,
    moveImpl: (source, destination) => {
      moves += 1;
      if (moves === 2) throw new Error('simulated bridge move failure');
      fs.renameSync(source, destination);
    }
  }), /已清理本次半成品/);
  assert.equal(fs.existsSync(nativeDestination), false);
  assert.deepEqual(fs.readdirSync(sdkDestination), ['.gitkeep']);
}));

test('检测到不完整导入残留时不会自动删除用户文件', () => withTempDirectory((directory) => {
  const sdkDestination = path.join(directory, 'sdk', 'linux-arm64', '3.26.100.14');
  const nativeDestination = path.join(directory, 'native', 'wemeet.cpp');
  fs.mkdirSync(sdkDestination, { recursive: true });
  fs.writeFileSync(path.join(sdkDestination, 'unknown-file'), 'keep');
  assert.throws(() => assertImportTargetsAvailable(sdkDestination, nativeDestination), /不完整的 SDK 导入残留/);
  assert.equal(fs.existsSync(path.join(sdkDestination, 'unknown-file')), true);
}));
