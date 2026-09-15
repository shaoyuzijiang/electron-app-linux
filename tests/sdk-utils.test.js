'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ELF_MACHINE_AARCH64,
  assertArm64Elf,
  assertSafeArchiveMember,
  assertSafeSymlinks,
  createSdkExtractionPlan,
  inspectElf,
  movePreservingLinks,
  sha256File,
  validateManifestFiles
} = require('../scripts/sdk-utils');
const { replaceRuntimeDirectory } = require('../scripts/stage-sdk');

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmsdk-test-'));
  try { return callback(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function writeElf(filePath, machine) {
  const buffer = Buffer.alloc(20);
  buffer.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
  buffer.writeUInt16LE(machine, 18);
  fs.writeFileSync(filePath, buffer);
}

function createArchiveMembers({ trailingDirectories = true } = {}) {
  const root = 'TMSDK_0300000000_3.26.100.14_arm64_default.publish';
  const directory = (value) => trailingDirectories ? `${value}/` : value;
  return [
    `${root}/`,
    `${root}/SDK/`,
    directory(`${root}/SDK/include`),
    `${root}/SDK/include/wemeet_sdk.h`,
    directory(`${root}/SDK/Release`),
    `${root}/SDK/Release/plugins/`,
    `${root}/SDK/Release/plugins/iconengines/`,
    `${root}/SDK/Release/plugins/iconengines/libqsvgicon.so`,
    `${root}/SDK/libwemeetsdk.so`,
    `${root}/SDK/libwemeet_base.so`,
    `${root}/SDK/saas_sdk_env.json`,
    `${root}/Electron_Demo/wemeet_sdk/wemeet.cpp`,
    `${root}/Electron_Demo/wemeet_sdk/jsoncpp.cpp`,
    directory(`${root}/Electron_Demo/include/json`),
    `${root}/Electron_Demo/include/json/json.h`,
    `${root}/Electron_Demo/include/json/json-forwards.h`,
    `${root}/Electron_Demo/output/linux/wemeet_electron_sdk.node`
  ];
}

test('识别 ELF64 AArch64 并拒绝非 ARM64 ELF', () => withTempDirectory((directory) => {
  const arm64 = path.join(directory, 'arm64.node');
  const x64 = path.join(directory, 'x64.node');
  writeElf(arm64, ELF_MACHINE_AARCH64);
  writeElf(x64, 62);
  assert.equal(inspectElf(arm64).machine, ELF_MACHINE_AARCH64);
  assert.doesNotThrow(() => assertArm64Elf(arm64));
  assert.throws(() => assertArm64Elf(x64), /期望 AArch64/);
}));

test('拒绝压缩包绝对路径和路径穿越', () => {
  assert.throws(() => assertSafeArchiveMember('../SDK/lib.so', 'package'), /路径穿越/);
  assert.throws(() => assertSafeArchiveMember('/SDK/lib.so', 'package'), /不安全/);
  assert.throws(() => assertSafeArchiveMember('other/SDK/lib.so', 'package'), /预期 SDK 根目录/);
});

test('拒绝逃逸或断裂的符号链接', () => withTempDirectory((directory) => {
  fs.writeFileSync(path.join(directory, 'inside'), 'ok');
  fs.symlinkSync('../outside', path.join(directory, 'escaped'));
  assert.throws(() => assertSafeSymlinks(directory), /逃逸 SDK 目录/);
}));

test('验证 manifest 文件哈希', () => withTempDirectory((directory) => {
  const filePath = path.join(directory, 'item');
  fs.writeFileSync(filePath, 'value');
  const manifest = { files: [{ path: 'item', sha256: sha256File(filePath) }] };
  assert.deepEqual(validateManifestFiles(manifest, (relativePath) => path.join(directory, relativePath)), []);
  fs.writeFileSync(filePath, 'changed');
  assert.deepEqual(validateManifestFiles(manifest, (relativePath) => path.join(directory, relativePath)), ['manifest SHA-256 不匹配：item']);
}));

test('GNU tar 风格成员列表生成仅含九项的桥接依赖提取计划', () => {
  const root = 'TMSDK_0300000000_3.26.100.14_arm64_default.publish';
  const plan = createSdkExtractionPlan(createArchiveMembers(), root);
  assert.equal(plan.extractMembers.length, 9);
  assert.ok(plan.extractMembers.includes(`${root}/SDK/include/`));
  assert.ok(plan.extractMembers.includes(`${root}/SDK/Release/`));
  assert.ok(plan.extractMembers.includes(`${root}/Electron_Demo/include/json/`));
  assert.ok(plan.extractMembers.includes(`${root}/Electron_Demo/wemeet_sdk/jsoncpp.cpp`));
  assert.equal(plan.extractMembers.some((member) => member.includes('Release/plugins/')), false);
  assert.equal(plan.extractMembers.some((member) => member.endsWith('json/json.h')), false);
  assert.equal(plan.usesFallbackMemberList, false);
});

test('目录成员不带末尾斜杠时仍生成最小桥接依赖计划', () => {
  const root = 'TMSDK_0300000000_3.26.100.14_arm64_default.publish';
  const plan = createSdkExtractionPlan(createArchiveMembers({ trailingDirectories: false }), root);
  assert.equal(plan.extractMembers.length, 9);
  assert.ok(plan.extractMembers.includes(`${root}/SDK/include`));
  assert.ok(plan.extractMembers.includes(`${root}/SDK/Release`));
  assert.ok(plan.extractMembers.includes(`${root}/Electron_Demo/include/json`));
});

test('跨设备暂存回退为复制并清理源目录', () => withTempDirectory((directory) => {
  const source = path.join(directory, '.sdk-stage-fixture');
  const destination = path.join(directory, 'output', 'linux-arm64');
  fs.mkdirSync(path.join(source, 'Release', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(source, 'wemeet_electron_sdk.node'), 'addon');
  fs.writeFileSync(path.join(source, 'Release', 'plugins', 'libqsvgicon.so'), 'plugin');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  movePreservingLinks(source, destination, {
    renameSync() { throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' }); },
    cpSync: fs.cpSync,
    rmSync: fs.rmSync
  });
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(path.join(destination, 'wemeet_electron_sdk.node'), 'utf8'), 'addon');
  assert.equal(fs.readFileSync(path.join(destination, 'Release', 'plugins', 'libqsvgicon.so'), 'utf8'), 'plugin');
}));

test('非跨设备错误直接抛出且不落盘半成品', () => withTempDirectory((directory) => {
  const source = path.join(directory, 'source');
  const destination = path.join(directory, 'destination');
  fs.mkdirSync(source);
  assert.throws(() => movePreservingLinks(source, destination, {
    renameSync() { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); }
  }), /permission denied/);
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.existsSync(destination), false);
}));

test('新 runtime 替换失败时恢复旧 runtime', () => withTempDirectory((directory) => {
  const runtimeRoot = path.join(directory, 'output', 'linux-arm64');
  const replacementRoot = path.join(directory, 'output', '.linux-arm64-next');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(replacementRoot, { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'old-marker'), 'old');
  fs.writeFileSync(path.join(replacementRoot, 'new-marker'), 'new');
  let renameCount = 0;
  const fsImpl = Object.assign({}, fs, {
    renameSync(source, destination) {
      renameCount += 1;
      if (renameCount === 2) throw new Error('simulated replacement failure');
      fs.renameSync(source, destination);
    }
  });
  assert.throws(() => replaceRuntimeDirectory({ replacementRoot, runtimeRoot, fsImpl }), /已恢复旧运行时/);
  assert.equal(fs.readFileSync(path.join(runtimeRoot, 'old-marker'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(replacementRoot, 'new-marker')), true);
}));

test('缺少必需文件或目录内容时拒绝归档', () => {
  const root = 'TMSDK_0300000000_3.26.100.14_arm64_default.publish';
  const members = createArchiveMembers().filter((member) => !member.endsWith('libwemeet_base.so'));
  assert.throws(() => createSdkExtractionPlan(members, root), /缺少必需文件/);
  const missingJsonCpp = createArchiveMembers().filter((member) => !member.endsWith('jsoncpp.cpp'));
  assert.throws(() => createSdkExtractionPlan(missingJsonCpp, root), /缺少必需文件/);
  const missingJsonHeader = createArchiveMembers().filter((member) => !member.endsWith('json-forwards.h'));
  assert.throws(() => createSdkExtractionPlan(missingJsonHeader, root), /缺少必需文件/);
  const missingRelease = createArchiveMembers().filter((member) => !member.includes('/SDK/Release'));
  assert.throws(() => createSdkExtractionPlan(missingRelease, root), /缺少必需目录或内容/);
});
