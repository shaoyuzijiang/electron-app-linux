'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SdkService } = require('../src/main/sdk/sdk-service');

const logger = { info() {}, error() {} };

test('Mock SDK 完成初始化、登录、入会、离会、登出与反初始化', async () => {
  const service = new SdkService({ mockEnabled: true, logger });
  await service.prepare();
  await service.initialize({ appName: '测试应用' });
  await service.login({ displayName: '测试用户' });
  await service.joinMeeting({ meetingCode: '123-456-789' });
  assert.equal(service.getSnapshot().inMeeting, true);
  await service.leaveMeeting();
  await service.logout();
  await service.uninitialize();

  const snapshot = service.getSnapshot();
  assert.equal(snapshot.state, 'RELEASED');
  assert.equal(snapshot.inMeeting, false);
  assert.equal(snapshot.callbacks.some((entry) => entry.event === 'OnSDKUninitializeResult'), true);
});
