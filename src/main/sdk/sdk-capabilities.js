'use strict';

const SDK_VERSION = '3.26.100.14';
const LINUX_UNSUPPORTED = Object.freeze([
  'EnableAddressBookCallback', 'EnableInviteUsersCallback', 'ShowScreenCastView', 'AddUsersWithParam', 'QueryLocalRecordInfo',
  'ShowRecordFolder', 'Transcode', 'DecodeUltrasoundScreenCastCode', 'StartScreenCast', 'LoginByJSON',
  'DiscoverNearScreenCastCode', 'ShowScreenShareView', 'ShowVoiceRecordView', 'ShowAIAssistantView',
  'ShowRoomsControllerView', 'SetUserConfiguration', 'GetUserConfiguration', 'SetAppearanceMode', 'GetAppearanceMode'
]);

const STATIC_SUPPORTED = Object.freeze({
  initialize: 'InitWemeetSDK',
  login: 'Login',
  logout: 'Logout',
  uninitialize: 'UninitWemeetSDK',
  joinMeeting: 'JoinMeeting',
  leaveMeeting: 'LeaveMeeting',
  meetingSettings: 'ShowMeetingSettings',
  captions: 'EnableCaption'
});

function createCapabilityMatrix(runtimeExports = Object.values(STATIC_SUPPORTED)) {
  const exported = new Set(runtimeExports);
  return Object.freeze(Object.fromEntries(Object.entries(STATIC_SUPPORTED).map(([capability, method]) => {
    const supported = exported.has(method) && !LINUX_UNSUPPORTED.includes(method);
    return [capability, { supported, method, reason: supported ? '' : '当前 Linux SDK 版本未提供该能力' }];
  })));
}

function publicCapabilities(runtimeExports) {
  return Object.fromEntries(Object.entries(createCapabilityMatrix(runtimeExports)).map(([name, item]) => [name, item.supported]));
}

module.exports = { SDK_VERSION, LINUX_UNSUPPORTED, STATIC_SUPPORTED, createCapabilityMatrix, publicCapabilities };
