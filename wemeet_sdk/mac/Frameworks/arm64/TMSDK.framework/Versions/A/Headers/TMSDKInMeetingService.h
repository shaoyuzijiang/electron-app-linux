
//
//  TMSDKInMeetingService.h
//  TMSDK
//
//  Created by Tencent on 2021/7/16.
//

#import <Foundation/Foundation.h>
#import <TMSDK/TMSDKErrors.h>
#import <TMSDK/TMSDKPreMeetingService.h>

typedef NS_ENUM(NSUInteger, TMSDKMeetingType) {
    TMSDKMeetingTypeNormal = 0,              // 普通会议,
    TMSDKMeetingTypeQuickMeeting = 1,        // 快速会议,
};

typedef NS_ENUM(NSUInteger, TMSDKMeetingConfigType) {
    TMSDKMeetingConfigTypeShareCallback  = 1,             // 分享回调,
    TMSDKMeetingConfigTypeMeetingInfoCallback  = 2,       // 会议信息回调,
};

typedef NS_ENUM(NSUInteger, TMSDKInMeetingWindowActionType) {
  TMSDKInMeetingWindowActionTypeImMeetingEnterFullScreen  = 0,             // 进入全屏,
  TMSDKInMeetingWindowActionTypeImMeetingExitFullScreen  = 1,       // 退出全屏,
};

typedef NS_ENUM(NSUInteger, TMSDKInMeetingLeaveCastRoomActionType) {
  TMSDKInMeetingLeaveCastRoomDefaultShowDialog  = 0,             // 弹框
  TMSDKInMeetingLeaveCastRoomLeaveMeeting = 1,       // 结束投屏后退会
  TMSDKInMeetingLeaveCastRoomStayInMeeting = 2,       // 结束投屏后留在会中
};

typedef NS_ENUM(NSUInteger, TMSDKInMeetingAudioStatus) {
  TMSDKInMeetingAudioStatusNone  = 0,             // 初始状态
  TMSDKInMeetingAudioStatusMuted  = 1,            // 自主关麦
  TMSDKInMeetingAudioStatusMutedByHost  = 2,      // 被主持人单独静音
  TMSDKInMeetingAudioStatusMutedAllByHost  = 3,   // 被主持人全体静音
  TMSDKInMeetingAudioStatusUnMuted  = 4,          // 自主开麦
  TMSDKInMeetingAudioStatusUnMutedByHost  = 5,    // 被主持人请求单独开麦
  TMSDKInMeetingAudioStatusUnMutedAllByHost  = 6, // 被主持人请求全体开麦
};

typedef NS_ENUM(NSUInteger, TMSDKInMeetingVideoStatus) {
  TMSDKInMeetingVideoStatusNone  = 0,             // 初始状态
  TMSDKInMeetingVideoStatusMuted  = 1,            // 自主关摄像头
  TMSDKInMeetingVideoStatusMutedByHost  = 2,      // 被主持人关摄像头
  TMSDKInMeetingVideoStatusUnMuted  = 3,          // 自主开摄像头
  TMSDKInMeetingVideoStatusUnMutedByHost  = 4,    // 被主持人请求后开摄像头
};

//分享回调内容
//会议信息回调内容
@interface TencentMeetingInfo : NSObject
/// 会议号
@property (nonatomic, copy) NSString *meetingCode;
/// 会议主题
@property (nonatomic, copy) NSString *subject;
/// 分享链接
@property (nonatomic, copy) NSString *meetingUrl;
/// 开始时间
@property (nonatomic, copy) NSString *startTime;
/// 结束时间
@property (nonatomic, copy) NSString *endTime;
/// 会议类型
@property (nonatomic, assign) TMSDKMeetingType meetingType;
/// 会议密码
@property (nonatomic, copy) NSString *password;
/// 主持人名字
@property (nonatomic, copy) NSString *hostName;
@end

@protocol TMSDKInMeetingDelegate <NSObject>

@optional

/**
 * @brief 退出会议事件结果回调
 * @param type 离会类型
 * @param code 错误码 0 表示成功, 其他表示失败
 * @param meetingCode 会议号
 * @param msg 描述信息
*/
- (void)onLeaveMeeting:(int)type code:(TMSDKError)code msg:(NSString *)msg meetingCode:(NSString *)meetingCode;

/**
 * @brief 用户在会议中点击邀请的回调
 * @param inviteInfo 分享内容
 */
- (void)onInviteMeeting:(NSString *)inviteInfo;

/**
 * @brief 会议信息展示回调
 * @param meetingInfo 展示会议信息
 */
- (void)onShowMeetingInfo:(NSString *)meetingInfo;

/**
 * @brief 会中邀请成员回调
 * @param jsonParam 成员列表
 */
- (void)onInviteUsers:(NSString *)jsonParam;

/**
 * @brief SDK主动向接入方请求组织架构信息
 * @param jsonUsers 成员列表
 */
- (void)onQueryCustomOrgInfo:(NSString *)jsonUsers;

/**
 * @brief 用户操作的回调
 *
 * @param actionType 用户行为操作
 * @param code 错误码
 * @param msg 描述信息
*/
- (void)onActionResult:(int)actionType code:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief 当字幕开关状态变化时回调，无论该变化是由用户UI操作引起的还是调用API接口设置引起的。
 *
 * @param is_open 字幕开启还是关闭
*/
- (void)onCaptionSwitchChanged:(BOOL) is_open;

/**
 * @brief 当字幕任意设置项被修改更新后回调，无论该变化是由用户UI操作引起的还是调用API接口设置引起的。
 *
 * @param json_param 字幕信息
*/
- (void)onCaptionSettingChanged:(NSString *)json_param;

/**
 * @brief 当前用户麦克风状态改变会收到此回调
 *
 * @param audio_status 参考TMSDKInMeetingAudioStatus
*/
- (void)onAudioStatusChanged:(int) audio_status;

/**
 * @brief 当前用户摄像头开关状态变化会收到此回调。
 *
 * @param video_status 参考TMSDKInMeetingVideoStatus
*/
- (void)onVideoStatusChanged:(int) video_status;

@end

@interface TMSDKInMeetingService : NSObject

@property (nonatomic, weak) id <TMSDKInMeetingDelegate> delegate;

/**
 * @brief 离开会议
 * @param leaveMeetingType
 * 0、所有设备离开会议
 * 1、结束会议（结束会议，仅当前账户是会议主持人时，该参数才有效。当非主持人时，调用结束会议等同于所有设备离开会议）
 * 2、仅当前设备离开会议 （当非多端入会场景时，调用仅当前设备离开会议等同于离开会议）
 */
- (void)leaveMeeting:(int)leaveMeetingType;

/**
 * @brief 会议中点击邀请的回调设置
 * @param enable 是否回调
 * @param show 是否显示信息页面
 */
- (void)enableInviteCallback:(BOOL)enable show:(BOOL)show;

/**
 * @brief 会议中点击邀请的回调设置
 * @param enable 是否回调
 * @param show 是否显示信息页面
 */
- (void)enableMeetingInfoCallback:(BOOL)enable show:(BOOL)show;

/**
 * @brief 将会议中界面置顶
 */
- (void)bringInMeetingViewTop;

- (NSString*)getCurrentMeetingInfo;

- (NSString*)getMeetingWindowInfo;

/**
 * @brief 开启会中邀请成员回调功能
 * @param enable 是否回调
 * @param show 是否显示会中邀请页面
 */
- (void)enableInviteUsersCallback:(BOOL)enable show:(BOOL)show;

/**
 * @brief 开启SDK定制化组织架构功能
 * @param enable 是否回调
 */
- (void)enableCustomOrgInfo:(BOOL)enable;

/**
 * @brief 接入方设置人员组织架构信息
 */
- (void)setCustomOrgInfo:(NSString *)jsonParam;

/**
 * @brief 会中窗口进入或者退出全屏
 */
- (void)manipulateWindow:(NSString *)action;

/**
 * @brief 开关会议中字幕展示组件
 * @param open 开关字幕
 * @param complete 调用API接口时的回调
 */
- (void)switchCaption:(BOOL)open complete:(void(^__nullable)(TMSDKError, NSString * __nullable))handler;

/**
 * @brief 更新字幕相关设置选项。
 * @param json_setting 字幕设置
 * @param complete 调用API接口时的回调
 */
- (void)updateCaptionSettings:(NSString *__nonnull)json_setting complete:(void(^__nullable)(TMSDKError, NSString * __nullable))handler;

/**
 * @brief 获取屏幕共享信息
 */
- (NSString *)getScreenShareInfo;


/**
 * @brief 设置投屏入会在会中退出会议弹窗形式。默认状态为：展示dialog
 */
- (void)setLeaveCastRoomActionType:(TMSDKInMeetingLeaveCastRoomActionType)actionType;


/**
 * @brief 订阅/退订会中事件
 */
- (TMSDKError)subscribeInMeetingActionEvent:(TMSDKActionType)actionType subscribe:(BOOL)subscribe subscriptionJson:(NSString *)subscriptionJson;

/**
 * @brief 切换布局
 * @param layoutJson 布局设置
 * @param complete 调用API接口时的回调
 */
- (void)switchLayout:(NSString *__nonnull)layoutJson complete:(void(^__nullable)(TMSDKError, NSString * __nullable))handler;

/**
 * @brief 显示屏幕共享页
 * @param complete 调用API接口时的回调
 */
- (void)showScreenShareView:(void(^__nullable)(TMSDKError, NSString * __nullable))handler;

@end
