'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCallback } = require('../src/main/sdk/callback-parser');

test('回调 JSON 解析并脱敏敏感字段', () => {
  const result = parseCallback('{"event":"OnLogin","token":"secret-value","nested":{"ssoUrl":"https://example.test/path"}}');
  assert.equal(result.ok, true);
  assert.equal(result.value.event, 'OnLogin');
  assert.equal(result.value.token, '[REDACTED]');
  assert.equal(result.value.nested.ssoUrl, '[REDACTED]');
});

test('回调解析拒绝无效 JSON 和非对象', () => {
  assert.deepEqual(parseCallback('{broken'), { ok: false, error: '回调不是有效 JSON' });
  assert.deepEqual(parseCallback('[1,2]'), { ok: false, error: '回调必须是 JSON 对象' });
});

test('回调解析拒绝超出大小限制的内容', () => {
  const oversized = `{"message":"${'a'.repeat(17 * 1024)}"}`;
  assert.deepEqual(parseCallback(oversized), { ok: false, error: '回调内容超过大小限制' });
});
