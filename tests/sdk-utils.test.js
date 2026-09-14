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
  inspectElf,
  sha256File,
  validateManifestFiles
} = require('../scripts/sdk-utils');

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
