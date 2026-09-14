'use strict';

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertRealRuntimeSupported, detectSessionType, getRuntimeRoot, prepareLinuxRuntime } = require('../src/main/sdk/linux-runtime');

test('根据开发态和打包态选择不同运行时路径', () => {
  assert.equal(getRuntimeRoot({ projectRoot: '/project', isPackaged: false }), path.join('/project', 'output', 'linux-arm64'));
  assert.equal(getRuntimeRoot({ resourcesPath: '/resources', isPackaged: true }), path.join('/resources', 'tmsdk', 'linux-arm64'));
});

test('识别 X11、Wayland 和未知会话', () => {
  assert.equal(detectSessionType({ XDG_SESSION_TYPE: 'x11' }), 'x11');
  assert.equal(detectSessionType({ XDG_SESSION_TYPE: 'wayland' }), 'wayland');
  assert.equal(detectSessionType({ XDG_SESSION_TYPE: 'mir' }), 'unknown');
});

test('非 Linux ARM64 环境禁止真实加载准备', async () => {
  assert.throws(() => assertRealRuntimeSupported({ platform: 'darwin', arch: 'arm64' }), /仅支持 linux\/arm64/);
  await assert.rejects(() => prepareLinuxRuntime({ processInfo: { platform: 'darwin', arch: 'arm64' } }), /仅支持 linux\/arm64/);
});
