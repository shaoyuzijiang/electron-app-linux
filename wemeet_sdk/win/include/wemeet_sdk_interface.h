#ifndef WEMEET_SDK_INTERFACE_H_
#define WEMEET_SDK_INTERFACE_H_

#include "wemeet_sdk_def.h"

#ifdef __cplusplus
extern "C" {
#endif

class ISDKCallback {
public:
  virtual ~ISDKCallback() {}
  virtual void OnSDKInitializeResult(int code, const char* msg) = 0;
  virtual void OnSDKUninitializeResult(int code, const char* msg) {}
  virtual void OnSDKTokenExpired(const char* sdk_token) = 0;
  virtual void OnSDKError(int code, const char* msg) = 0;
  virtual void OnShowLogsResult(int code, const char* msg) = 0;
  virtual void OnResetSDKState(int code, const char* msg) = 0;
  virtual void OnHandleWemeetAction(int action_type, const char* param) {}
  virtual void OnSetProxyResult(int code, const char* msg) = 0;
  virtual void OnHandleSchemaResult(int code, const char* msg) = 0;
  virtual void OnParseMeetingInfoUrl(int code, const char* msg) {}
  virtual void OnAddUsersResult(int user_type, int code, const char* msg) {}
  virtual void OnActiveUploadLogsResult(int code, const char* msg) {}
};

class IAuthenticationCallback {
public:
  virtual ~IAuthenticationCallback() {}
  virtual void OnLogin(int code, const char* msg) = 0;
  virtual void OnLogout(int type, int code, const char* msg) = 0;
  virtual void OnJumpUrlWithLoginStatus(int code, const char* msg) = 0;
};

class IPreMeetingCallback {
public:
  virtual ~IPreMeetingCallback() {}
  virtual void OnJoinMeeting(int code, const char* msg, const char* meeting_code) = 0;
  virtual void OnShowScreenCastViewResult(int code, const char* msg) = 0;
  virtual void OnActionResult(int action_type, int code, const char* msg) = 0;
  virtual void OnShowAddressBook(int user_type, const char* msg) {}
  virtual void OnRingInvitationEvent(int ring_state, const char* msg) = 0;
  virtual void OnVoiceRecordStatusChange(int status, const char* msg) = 0;
};

class IInMeetingCallback {
public:
  virtual ~IInMeetingCallback() {}
  virtual void OnLeaveMeeting(int type, int code, const char* msg, const char* meeting_code) = 0;
  virtual void OnInviteMeeting(const char* invite_info) = 0;
  virtual void OnShowMeetingInfo(const char* meeting_info) = 0;
  virtual void OnQueryCustomOrgInfo(const char* json_data) {}
  virtual void OnInviteUsers(const char* json_data) {}
  virtual void OnActionResult(int action_type, int code, const char* msg) = 0;
  virtual void OnCaptionSwitchChanged(bool is_open) = 0;
  virtual void OnCaptionSettingChanged(const char* json_param) = 0;
  virtual void OnAudioStatusChanged(int audio_status) {}
  virtual void OnVideoStatusChanged(int video_status) {}
};

class IUserConfigCallback {
public:
  virtual ~IUserConfigCallback() {}
  virtual void OnSetUserConfig(int type, int code, const char* msg) = 0;
  virtual void OnGetUserConfig(int type, int code, const char* msg) = 0;
};

#ifdef __cplusplus
} /* end of the 'extern "C"' block */
#endif

#endif  // WEMEET_SDK_INTERFACE_H_
