'use strict';

const assert = require('assert');
const { ACTIONS, supports } = require('../common/contracts/capabilities');
const { getPlatformCapabilities } = require('../platform');

const desktop = getPlatformCapabilities('darwin', 'arm64');
const windows = getPlatformCapabilities('win32', 'x64');
const linux = getPlatformCapabilities('linux', 'arm64');

for (const action of ACTIONS) {
  assert.strictEqual(typeof desktop[action], 'boolean', `桌面端缺少能力 ${action}`);
  assert.strictEqual(typeof windows[action], 'boolean', `Windows 缺少能力 ${action}`);
  assert.strictEqual(typeof linux[action], 'boolean', `Linux 缺少能力 ${action}`);
}

for (const action of [
  'meeting.join', 'meeting.quick', 'meeting.leave',
  'view.join', 'view.schedule', 'view.settings', 'view.history', 'view.detail',
  'feature.im', 'feature.calendar', 'feature.contacts',
]) assert.strictEqual(supports(linux, action), true, `Linux 3.26 应支持 ${action}`);

for (const action of [
  'view.screenCast', 'view.voiceRecord', 'view.record', 'view.rooms', 'settings.userConfiguration',
  'meeting.inviteUsers', 'meeting.captions', 'meeting.aiAssistant',
  'feature.webView', 'feature.enterpriseSso',
]) assert.strictEqual(supports(linux, action), false, `Linux 3.26 不应暴露 ${action}`);

assert.throws(() => getPlatformCapabilities('linux', 'x64'), /未支持的平台/);
console.log(`平台能力契约校验通过：${ACTIONS.length} 项统一能力。`);
