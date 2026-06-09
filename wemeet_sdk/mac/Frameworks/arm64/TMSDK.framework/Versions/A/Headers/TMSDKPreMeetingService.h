//
//  TMSDKPreMeetingService.h
//  TMSDK
//
//  Created by Tencent on 2021/7/16.
//

#import <Foundation/Foundation.h>
#import <TMSDK/TMSDKErrors.h>

typedef NS_ENUM(NSUInteger, TMSDKActionType) {
  //premeeting:
  ShowPreMeetingView,
  ShowScreenCastView,
  ShowHistoricalMeetingView,
  ShowMeetingDetailView,
  ShowJoinMeetingView,
  ShowScheduleMeetingView,
  ShowMeetingSettingView,
  ClosePreMeetingView,
  QeuryMeetingInfo,
  InviteUsers,
  QueryLocalRecordInfo,
  Transcode,
  DecodeUltrasoundScreenCastCode,
  StartScreenCast,
  OpenLogPageView,
  DiscoverNearScreenCastCode,
  ShowAIAssistantView,
  ShowVoiceRecordView,
  ShowRoomsController,
  //inmeeting:
  SetCustomOrgInfo = 1000,
  HandleFullScreen,
  ScreenShareComplete,
  BreakoutRoomStatusChange,
  OpenAppStatusChange,
  CloudRecordStateChange,
};

typedef NS_ENUM(NSUInteger, TMSDKMainUIStyle) {
  kTMSDKMainUIStyleClassic,
  kTMSDKMainUIStyleTabs
};

typedef NS_ENUM(NSUInteger, TMSDKPremeetingViewType) {
  kTMSDKPremeetingViewTypeMeeting,
  kTMSDKPremeetingViewTypeContact,
  kTMSDKPremeetingViewTypeRecord
};

NS_ASSUME_NONNULL_BEGIN

@interface TMSDKJoinParams : NSObject
/// 会议号
@property (nonatomic, copy) NSString *meetingCode;
/// 会议中显示的名称
@property (nonatomic, copy) NSString *userDisplayName;
/// 会议密码
@property (nonatomic, copy) NSString *password;
/// 自定义邀请链接
@property (nonatomic, copy) NSString *inviteUrl;
/// 会中窗口的Title
@property (nonatomic, copy) NSString *meetingWindowTitle;
/// 是否开启麦克风
@property (nonatomic, assign) BOOL micOn;
/// 是否开启摄像头
@property (nonatomic, assign) BOOL cameraOn;
/// 是否开启美颜
@property (nonatomic, assign) BOOL faceBeautyOn;

@end

@protocol TMSDKPreMeetingDelegate <NSObject>

@optional

/**
 * @brief 进入会议事件的结果回调
 *
 * @param code 错误码
 * @param msg 描述信息
 * @param meetingCode 会议号
*/
- (void)onJoinMeeting:(TMSDKError)code msg:(NSString *)msg meetingCode:(NSString *)meetingCode;

/**
 * @brief 打开无线投屏的回调
 *
 * @param code 错误码
 * @param msg 描述信息
*/
- (void)onShowScreenCastViewResult:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief 超声波投屏解码结果
 *
 * @param code 错误码
 * @param msg 描述信息
*/
- (void)onGetScreenCastDecodeResult:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief 用户操作的回调
 *
 * @param actionType 用户行为操作
 * @param code 错误码
 * @param msg 描述信息
*/
- (void)onActionResult:(int)actionType code:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief 用户点击通讯录选人时的回调
 *
 * @param userType 1——预定会议主持人 2——预定会议成员
 * @param jsonData 错误码
*/
- (void)onShowAddressBook:(int)userType jsonData:(NSString *)jsonData;

/**
 * @brief 用户收到响铃邀请时的回调
 *
 * @param ringState 响铃状态
 * @param ringInfo 响铃信息
*/
- (void)onRingInvitationEvent:(int)ringState ringInfo:(NSString *)ringInfo;

/**
 * @brief 当录音笔状态发生变化时候，通过回调函数通知用户
 *
 * @param status 录音笔状态
 * @param msg 录音笔信息
*/
- (void)onVoiceRecordStatusChange:(int)status msg:(NSString *)msg;
@end

@interface TMSDKPreMeetingService : NSObject

@property (weak, nonatomic) id<TMSDKPreMeetingDelegate> delegate;

/**
 * @brief 加入会议
 * @param joinParams 入会参数.
 */
- (void)joinMeeting:(TMSDKJoinParams *)joinParams;

/**
 * @brief 通过Json串加入会议
 * @param joinMeetingJSON 入会的Json参数.
 */
- (void)joinMeetingByJSON:(NSString *)joinMeetingJSON;

/**
 * @brief 快速会议
 */
- (void)quickMeeting;

/**
 * @brief 快速会议
 * @param quickMeetingJSON 入会参数.  meeting_window_title 会中窗口标题
 */
- (void)quickMeetingByJSON:(NSString *)quickMeetingJSON;

/**
 * @brief 展示会前主界面
 */
- (void)showPremeetingView;

- (void)showPremeetingView:(TMSDKMainUIStyle)stype;

- (void)showPremeetingView:(TMSDKMainUIStyle)style premeetingViewType:(TMSDKPremeetingViewType) type;

/**
 * @brief 无线投屏
 */
- (void)showScreenCastView;

/**
 * @brief 获取超声波投屏码
 */
- (void)decodeUltrasoundScreenCastCode;

/**
 * @brief 获取近场发现(超声波&蓝牙)投屏码
 * @param discoverJSON 近场发现的JSON参数.
 */
- (void)discoverNearScreenCastCode:(NSString *)discoverJSON;

/**
 * @brief 开始无线投屏
 */
- (void)startScreenCast:(NSString*)screenCastJson;

/**
 * @brief 查询历史会议
 */
- (void)showHistoricalMeetingView;

/**
 *@brief查询某一具体会议
 */
- (void)showMeetingDetailView:(NSString *)meetingId currentSubMeetingId:(NSString *)currentSubMeetingId;

- (void)showMeetingDetailView:(NSString *)meetingId currentSubMeetingId:(NSString *)currentSubMeetingId startTime:(NSString *)startTime isHistory:(BOOL)isHistory;

/**
 *@brief展示加入会议界面
 */
- (void)showJoinMeetingView;

/**
 *@brief展示预定会议界面
 */
- (void)showScheduleMeetingView:(int)meetingType;

/**
 *@brief展示设置管理界面
 */
- (void)showMeetingSettingView;


/**
 *@brief展示录音笔界面
 */
- (void)showVoiceRecordView;

/**
 *@brief展示AI小助手界面
 */
- (void)showAIAssistantView;

/**
 *@brief展示Rooms控制器界面
 */
- (void)showRoomsControllerView;

/**
 * @brief 唤起日志上传页面
 */
- (void)showUploadLogsView;

/**
// *@brief邀请人之后，将结果传给SDK
// */
//- (void)inviteUsers:(NSString *)meetingId data:(NSString *)data;

/**
 *@brief查询会议信息，结果通过onActionResult获取
 */
- (void)queryMeetingInfo:(NSString *)param;

/**
 * 查询会议录制信息信息，结果通过onActionResult获取
 * @param meetingId 会议id;
 * @param subMeetingId 周期会议的id，非周期会议传0;
*/
- (void)queryLocalRecordInfo:(NSString*)meetingId subMeetingId:(NSString*)subMeetingId;

/**
 * 转码
 * @param pathId queryLocalRecordInfo接口返回数据中的“path_id”字段
 */
- (void)transcode:(NSString *)pathId;

/**
 * 打开指定目录
 *@param pathId queryLocalRecordInfo接口返回数据中的“path_id”字段
 * @note 打开指定目录
 */
- (void)showRecordFolder:(NSString *)pathId;

/**
 * @brief 会议中自定义邀请的回调设置
 * @param enable 是否回调
 * @param show 是否显示自定义邀请页面
 */
- (void)enableAddressBookCallback:(BOOL)enable show:(BOOL)show;

/**
 * @brief 是否显示SDK响铃邀请界面
 */
- (void)enableRingInvitationView:(BOOL) enable;

/**
 * @brief 处理响铃邀请。
 * @param accept 同意/拒绝响铃
 * @param inviteId 响铃的标识
 * @param complete 调用API接口时的回调
 */
- (void)handleRingInvitation:(BOOL)acceot inviteId:(NSString *)inviteId complete:(void(^__nullable)(TMSDKError, NSString * __nullable))handler;
@end

NS_ASSUME_NONNULL_END
