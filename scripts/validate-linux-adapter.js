'use strict';

const assert = require('assert');
const { createLinuxSdkAdapter, validateSsoUrl } = require('../platform/linux-arm64/sdk-adapter');
const { validateJoinPayload, validateMeetingPayload } = require('../platform/linux-arm64/ipc');

async function run() {
  let callback = null;
  const calls = [];
  const joinArgsHistory = [];
  const addon = {
    AddJsCallback(listener) { callback = listener; },
    DisposeJsCallback() { callback = null; },
    GetSDKVersion: () => '3.26.100.14',
    InitWemeetSDK() { calls.push('initialize'); callback(JSON.stringify({ func: 'OnSDKInitializeResult', code: 0 })); return 0; },
    Login() { calls.push('login'); callback(JSON.stringify({ func: 'OnLogin', code: 0 })); return 0; },
    Logout: () => 0,
    RefreshSDKToken: () => 0,
    JoinMeeting(...args) { calls.push('join'); joinArgsHistory.push(args); callback(JSON.stringify({ func: 'OnJoinMeeting', code: 0 })); return 0; },
    QuickMeeting() { calls.push('quick'); callback(JSON.stringify({ func: 'OnJoinMeeting', code: 0 })); return 0; },
    LeaveMeeting() { calls.push('leave'); callback(JSON.stringify({ func: 'OnLeaveMeeting', code: 0 })); return 0; },
    ForceQuit() { calls.push('quit'); callback(JSON.stringify({ func: 'OnSDKUninitializeResult', code: 0 })); return 0; },
    ShowJoinMeetingView: () => 0,
    ShowScheduleMeetingView: () => 0,
    ShowMeetingSettingView: () => 0,
    ShowHistoricalMeetingView: () => 0,
    ShowMeetingDetailView: () => 0,
  };
  const adapter = createLinuxSdkAdapter({
    app: { getPath: () => '/tmp/tm-sdk-test', getName: () => 'Tencent Meeting SDK Demo' },
    api: {
      getSdkToken: async (accessToken) => { assert.strictEqual(accessToken, 'access-token'); return { sdkId: '1', sdkToken: 'sdk-token' }; },
      getIdToken: async (accessToken) => { assert.strictEqual(accessToken, 'access-token'); return { ssoUrl: 'https://meeting.qq.com/cidp/test' }; },
    },
    getSdkRoot: () => '/tmp/sdk',
    getAppIconPath: () => '/tmp/icon.png',
    requireAddon: () => addon,
    runtime: { platform: 'linux', arch: 'arm64' },
  });

  await adapter.load();
  await adapter.activateSession(false);
  await adapter.ensureLoggedIn(async () => 'access-token');
  assert.deepStrictEqual(calls.slice(0, 2), ['initialize', 'login']);
  assert.strictEqual(adapter.getStatus().loggedIn, true);

  await adapter.joinMeeting({ meetingCode: '12345678', displayName: 'demo', password: '' });
  assert.strictEqual(adapter.getStatus().inMeeting, true);
  // SDK 3.26 参数顺序：mic_on=args[4], camera_on=args[5]；默认开视频。
  assert.strictEqual(joinArgsHistory[0][4], true, '入会默认开麦克风');
  assert.strictEqual(joinArgsHistory[0][5], true, '入会默认开视频（与 SDK 设置页“入会开启视频”预期一致）');
  await adapter.joinMeeting({ meetingCode: '12345678', cameraOn: false });
  assert.strictEqual(joinArgsHistory[1][5], false, 'cameraOn=false 必须显式关闭入会视频');
  await adapter.leaveMeeting();
  assert.strictEqual(adapter.getStatus().inMeeting, false);
  await adapter.openView('settings');
  await adapter.cancelSession();
  assert(calls.includes('quit'));

  assert.deepStrictEqual(validateJoinPayload({ meetingCode: '123-45 678', displayName: 'demo' }), { meetingCode: '12345678', displayName: 'demo', password: '', cameraOn: true });
  assert.strictEqual(validateJoinPayload({ meetingCode: '12345678', cameraOn: false }).cameraOn, false);
  assert.throws(() => validateJoinPayload({ meetingCode: 'abc' }), /会议号/);
  assert.throws(() => validateJoinPayload({ meetingCode: '12345678', displayName: 'x'.repeat(129) }), /显示名称/);
  assert.strictEqual(validateMeetingPayload({ subject: 'Demo', start_time: 1, end_time: 2, settings: { mute_enable_type_join: 1 } }, true).instanceid, 10);
  assert.throws(() => validateMeetingPayload({ subject: '', start_time: 1, end_time: 2 }, true), /主题/);
  assert.strictEqual(validateSsoUrl('https://meeting.qq.com/cidp/test').startsWith('https://'), true);
  assert.throws(() => validateSsoUrl('https://evil.example/cidp/test'), /不受信任/);
  console.log('Linux SDK adapter 与安全 IPC DTO 校验通过。');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
