//
//  TMSDKErrors.h
//  TMSDK
//
//  Created by 余笃 on 2021/7/16.
//

#pragma once

typedef NS_ENUM(int64_t, TMSDKError) {
    TMSDKError_Success = 0,
    TMSDKError_ServerConfigFail = -1001,
    TMSDKError_InvalidAuthCode = -1002,
    TMSDKError_LogoutInMeeting = -1003,
    TMSDKError_LoginAborted = -1004,
    TMSDKError_Unknown = -1005,
    TMSDKError_UserNotAuthorized = -1006,
    TMSDKError_UserInMeeting = -1007,
    TMSDKError_InvalidParam = -1008,
    TMSDKError_InvalidMeetingCode = -1009,
    TMSDKError_InvalidNickname = -1010,
    TMSDKError_DuplicateInitCall = -1011,
    TMSDKError_AccountAlreadyLogin = -1012,
    TMSDKError_SdkNotInitialized = -1013,
    TMSDKError_SyncCallTimeout = -1014,
    TMSDKError_NotInMeeting = -1015,
    TMSDKError_CancelJoin = -1016,
    TMSDKError_IsLogining = -1017,
    TMSDKError_NetError = -1018,
    TMSDKError_TokenVerifyFailed = -1019,
    TMSDKError_MultiAccountLoginConflict = -1021,
    TMSDKError_JoinMeetingServiceFailed = -1022,
    TMSDKError_ActionConflict = -1023,
    TMSDKError_InvalidJsonString = -1024,
    TMSDKError_ProxySetFailed = -1025,
    TMSDKError_InvalidSchemaString = -1026,
    TMSDKError_NotSupportSwitchPip = -1027,
    TMSDKError_InMeetingBackgroundNotSupportSwitchPip = -1028,
    TMSDKError_EnterPipFail = -1029,
    TMSDKError_EnterPipPermissionReject = -1030,
    TMSDKError_InvalidMeetingId = -1031,
    TMSDKError_DuplicateUninitCall = -1032,
    TMSDKError_UnableCallUninit = -1033,
    TMSDKError_UnInitFailInMeeting = -1034,
    TMSDKError_UnInitFailedOrCancel = -1035,
    TMSDKError_TranscodeFail = -1037,
    TMSDKError_IncorrectParamWithinJson = -1038,
    TMSDKError_NoUltrasoundCastCode = -1039,
    TMSDKError_NoMediaDeviceAccessible = -1040,
    TMSDKError_NoUltrasoundAbility = -1041,
    TMSDKError_NoCastAbility = -1042,
    TMSDKError_RoomsCodeError = -1043,
    TMSDKError_NoScreenCapturePermission = -1044,
    TMSDKError_PasswordError = -1045,
    TMSDKError_JoinMeetingFail = -1046,
    TMSDKError_ShareFail = -1047,
    TMSDKError_ActionRefused = -1048,
    TMSDKError_JoinBreakoutRoomFailed = -1049,
    TMSDKError_UpStreamLimited = -1050,
    TMSDKError_UpStreamNoPermission = -1051,
    TMSDKError_UserNoPermissionStopLive = -1052,
    TMSDKError_NoHostPermission = -1053,

    TMSDKError_ServerResourceConstraint = -2001,
    TMSDKError_AddHostMoreThen10 = -2003,
    TMSDKError_AddNormalMoreThen300 = -2004,
    TMSDKError_AddUsersUidIsEmpty = -2005,
    TMSDKError_AddUsersMembersModelError = -2006,

    TMSDKError_InnerCallError = -3001,
    TMSDKError_DuplicatedCall = -3002,
};

typedef NS_ENUM(NSInteger, TMLoginType) {
    TMLoginTypeWeWork                     = 1,
};
