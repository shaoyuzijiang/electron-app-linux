'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LINUX_UNSUPPORTED, STATIC_SUPPORTED, createCapabilityMatrix, publicCapabilities } = require('../src/main/sdk/sdk-capabilities');

test('Linux 3.26 能力矩阵只在导出接口存在时启用能力', () => {
  const matrix = createCapabilityMatrix(['InitWemeetSDK', 'Login', 'JoinMeeting']);
  assert.equal(matrix.initialize.supported, true);
  assert.equal(matrix.login.supported, true);
  assert.equal(matrix.joinMeeting.supported, true);
  assert.equal(matrix.leaveMeeting.supported, false);
});

test('明确排除的 Linux 接口永远不进入支持项', () => {
  assert.ok(LINUX_UNSUPPORTED.includes('StartScreenCast'));
  const capabilities = publicCapabilities(Object.values(STATIC_SUPPORTED));
  assert.equal(capabilities.joinMeeting, true);
  assert.equal('StartScreenCast' in capabilities, false);
});
