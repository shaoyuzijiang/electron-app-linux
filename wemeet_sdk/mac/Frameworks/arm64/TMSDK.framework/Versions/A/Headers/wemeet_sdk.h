#ifndef WEMEET_SDK_H_
#define WEMEET_SDK_H_

#include "wemeet_sdk_def.h"
#include "wemeet_sdk_interface.h"
#include <stdint.h>

class IWemeetSDK;

typedef void (*CompleteHandler)(int, const char*, void*);
typedef void (*CompleteHandlerWithValue)(int, const char*, const char*, void*);

#ifdef __cplusplus
extern "C" {
#endif

WEMEET_SDK_API IWemeetSDK* GetWemeetSDKInstance();

WEMEET_SDK_API void ReleaseWemeetSDKInstance();

WEMEET_SDK_API void GetWemeetSDKVersion(char* buf, int len);

#ifdef __cplusplus
}  /* end of the 'extern "C"' block */
#endif

class IAccountService {
public:
  virtual void SetCallback(IAuthenticationCallback* callback) = 0;

  virtual void Login(const char* sso_url) = 0;
    
  virtual void LoginByAccountPassword(const char* login_url, const char* user_name, const char* passwd) = 0;

  virtual void LoginByCode(const char* auth_code, const char* user_id, int login_type) = 0;

  virtual void LoginByJSON(const char* login_json) = 0;
  
  virtual void Logout() = 0;

  virtual bool IsLoggedIn() = 0;

  virtual void JumpUrlWithLoginStatus(const char* target_url) = 0;

  virtual void GetUrlWithLoginStatus(const char* target_url, char* buf, int buf_len) = 0;
// *** Debug Code Begin, These Code should only exist on dev_release ***
  virtual void GetUserInfo(char* buf, int buf_len) = 0;
// *** Debug Code End, These Code should only exist on dev_release ***
};

class IPreMeetingService {
public:
  virtual void SetCallback(IPreMeetingCallback* callback) = 0;

  /**
  * 加入会议
  *
  * @params params 入会参数
  *
  * @note 加入指定会议
  */
  virtual void JoinMeeting(const JoinMeetingParams& params) = 0;

  /**
  * 加入会议
  *
  * @params join_param 入会参数
  *
  * @note 加入指定会议
  */
  virtual void JoinMeetingByJSON(const char* join_param) = 0;
  /**
  *
  * @note 快速会议
  * @params join_param 入会参数
  */
  virtual void QuickMeetingByJSON(const char* join_param) = 0;

  /**
  *
  * @note 快速会议
  */
  virtual void QuickMeeting() = 0;

  /**
  *
  * @note 显示home界面
  */
  virtual void ShowPreMeetingView(WM_PRE_MEETING_VIEW_STYLE style = WM_PRE_MEETING_VIEW_STYLE_CLASSIC
                                  , PremeetingViewType type = kPremeetingViewTypeMeeting) = 0;

  /**
  *
  * @note 无线投屏
  */
  virtual void ShowScreenCastView() = 0;
  
  /**
  *
  * @note 解码超声波投屏码
  */
  virtual void DecodeUltrasoundScreenCastCode() = 0;
  
  /**
  *
  * @note 获取近场发现(超声波&蓝牙)投屏码
  */
  virtual void DiscoverNearScreenCastCode(const char* join_param) = 0;
  
  /**
  *
  * @note 无线投屏
  */
  virtual void StartScreenCast(const char* join_param) = 0;

  /**
  *
  * @note 历史会议
  */
  virtual void ShowHistoricalMeetingView() = 0;
    
  /**
  *
  * @note 会议详情
  */
  virtual void ShowMeetingDetailView(const char* meeting_id, const char* current_sub_meeting_id) = 0;
  virtual void ShowMeetingDetailView(const char* meeting_id, const char* current_sub_meeting_id, const char* start_time, bool is_history = true) = 0;
  /**
  *
  * @note 显示设置界面
  */
  virtual void ShowMeetingSettingView() = 0;

  /**
  *
  * @note 显示AI小助手界面
  */
  virtual void ShowAIAssistantView() = 0;

  /**
  *
  * @note 显示Rooms控制器界面
  */
  virtual void ShowRoomsControllerView() = 0;

  /**
 * 打开日志上传UI
 *
 * @note 打开日志上传UI
 */
  virtual void ShowUploadLogsView() = 0;

  /**
  *
  * @note 加入会议
  */
  virtual void ShowJoinMeetingView() = 0;

  /**
  *
  * @note 预定会议
  */
  virtual void ShowScheduleMeetingView(int meeting_type) = 0;

  /**
  *
  * @note 打开录音笔录制窗口
  */
  virtual void ShowVoiceRecordView() = 0;

  /**
  *
  * @note 预定会议时邀请用户
  */
  // *** Debug Code Begin, These Code should only exist on dev_release ***
  virtual void InviteUsers(const char* meeting_id, const char* data) = 0;
  // *** Debug Code End, These Code should only exist on dev_release ***

  /**
  *
  * @note 查询会议信息
  */
  virtual void QueryMeetingInfo(const char* data) = 0;

  /**
   * 查询本地会议录制信息信息
   * @param meeting_id 会议id; sub_meeting_id 周期会议的id，非周期会议传0;
   * @note
  */
  virtual void QueryLocalRecordInfo(const char* meeting_id, const char* sub_meeting_id) = 0;

  /**
   * 打开指定目录
   * @param path_id QueryLocalRecordInfo接口返回数据中的“path_id”字段
   * @note 打开指定目录
   */
  virtual void ShowRecordFolder(const char* path_id) = 0;

 /**
  * 转码
  * @param path_id QueryLocalRecordInfo接口返回数据中的“path_id”字段
  * @note
  */
  virtual void Transcode(const char* path_id) = 0;

  /**
  *
  * @note 开启会前通讯录回调功能
  */
  virtual void EnableAddressBookCallback(bool enable, bool show) {}

  /**
  *
  * 设置是否显示SDK响铃邀请界面
  */
  virtual void EnableRingInvitationView(bool enable) = 0;
  
  /**
  *
  * 处理响铃邀请
  */
  virtual void HandleRingInvitation(bool accept, const char* invite_id, CompleteHandler handler, void* user_data) = 0;
};

class IInMeetingService {
public:
  virtual void SetCallback(IInMeetingCallback* callback) = 0;

  virtual void LeaveMeeting(int leave_meeting_type) = 0;

  virtual void EnableInviteCallback(bool enable, bool show) = 0;

  virtual void EnableMeetingInfoCallback(bool enable, bool show) = 0;

  virtual void EnableInviteUsersCallback(bool enable, bool show) {}

  virtual void EnableCustomOrgInfo(bool enable) {}
  /**
  * 将会中窗口置顶
  *
  * @note 如果没有会中窗口，则不做任何操作
  */
  virtual void BringInMeetingViewTop() = 0;

  virtual void GetCurrentMeetingInfo(char* buf, int len) = 0;
  
  virtual void GetMeetingWindowInfo(char* buf, int len) = 0;

  virtual void SetCustomOrgInfo(const char* json_param) {}

  virtual void ManipulateWindow(const char* action) = 0;
  
  virtual void SwitchCaption(bool open, CompleteHandler handler, void* user_data) = 0;
  
  virtual void UpdateCaptionSettings(const char* json_setting, CompleteHandler handler, void* user_data) = 0;

  virtual void GetScreenShareInfo(char* buf, int len) = 0;
  
  virtual void SwitchLayout(const char* layout_json, CompleteHandler handler, void* user_data) {}
  
  virtual void SetLeaveCastRoomActionType(InMeetingLeaveCastRoomActionType action_type = kInMeetingLeaveCastRoomDefaultShowDialog) {}
  
  virtual int SubscribeInMeetingActionEvent(WM_ActionType action_type, bool subscribe, const char* subscription_json) = 0;

  virtual void ShowScreenShareView(CompleteHandler handler, void* user_data) = 0;
};

class IUserConfigService {
public:
  virtual void SetCallback(IUserConfigCallback* callback) = 0;
  //设置用户配置
  virtual void SetUserConfiguration(const char* config_key, const char* config_value, CompleteHandler complete, void* user_data) = 0;

  //获取用户配置
  virtual void GetUserConfiguration(const char* config_key, CompleteHandlerWithValue complete, void* user_data) = 0;
};

class WEMEET_SDK_API IWemeetSDK {
public:
  virtual ~IWemeetSDK() { }

  /**
  * 初始化
  *
  * @param params 初始化参数，详情见InitParams的定义
  *
  * @note 使用WemeetSDK之前必须先初始化SDK
  */
  virtual void Initialize(const InitParams& params, ISDKCallback* sdk_callback) = 0;

  /**
  * 设置SDK回调
  *
  * @param sdk_callback 回调设置
  *
  * @note 使用WemeetSDK设置回调接口
  */
  virtual void SetCallback(ISDKCallback* sdk_callback) = 0;

  /*
  * SDK 是否已经初始化
  *
  * @note 使用WemeetSDK之前必须先初始化SDK
  */  
  virtual bool IsInitialized() = 0;

  /**
  * 反初始化
  *
  * @note 退出应用前调用
  */
  virtual void Uninitialize(const char* param) = 0;

  /**
  * 更新SDK token
  *
  * @param new_sdk_token 新的sdk token
  *
  * @note 更新SDK Token，替换掉过期或快过期的SDK Token
  */
  virtual int RefreshSDKToken(const char* new_sdk_token) = 0;

  /*
  * 获取当前 sdk_token
  *
  * @param buf 输出缓冲区
  *
  * @note 获取SDK token
  */
  virtual void GetCurrentSDKToken(char* buf, int buf_len) {}

  /**
  * 打开日志目录
  *
  * @note 打开日志目录，方便获取错误日志
  */
  virtual void ShowLogs() = 0;


/**
  * 显示SDK界面
  *
  * @param params json字符串
  *
  * @note 显示SDK界面
  */
  virtual void ShowSDKView(const char* params) = 0;
  /**
  * 将SDK窗口置顶
  *
  * @note SDK如果没有窗口，则不做任何操作
  */
  virtual void BringViewTop() = 0;

  /**
  * 根据开始和结束时间，返回会议SDK的日志文件路径
  *
  * @param beign_time 日志文件的开始时间戳 单位秒
  * @param end_time 日志文件的结束时间戳 单位秒
  * @param len len为0返回实际json串长度，len小于实际json串长度，返回空串
  * @return 返回结果json串长度
  *
  * @note 获取日志文件绝对路径宇符串数组，每个小时1个日志文件，以json串形式返回
   */
  virtual uint64_t CollectLogFiles(uint64_t beign_time, uint64_t end_time, char* buf, uint64_t len) = 0;


  /**
  * 根据开始和结束时间，返回会议SDK的日志文件路径
  *
  * @param beign_time 日志文件的开始时间戳 单位秒
  * @param end_time 日志文件的结束时间戳 单位秒
  * @param len len为0返回实际json串长度，len小于实际json串长度，返回空串
  * @return 返回结果json串长度
  * @param buf 日志上传的描述字段
  *
  * @note 基于begin_time和end_time的时间戳上传对应范围的文件
   */
  virtual void ActiveUploadLogs(uint64_t beign_time, uint64_t end_time, const char* buf) = 0;

  /**
  * 设置代理服务器
  *
  * @note 初始化后设置服务代理
  */
  virtual void SetProxyInfo(const char* proxy_info) = 0;
  
  /**
  * 查询代理信息
  *
  * @note 初始化后查询代理
  */
  virtual void GetProxyInfo(char* buf, int len) = 0;

  /**
  * 一键跳转
  *
  * @note 符合跳转链接跳转，否则不做任何操作
  */
  virtual void HandleSchema(const char* schema_url) = 0;

  /**
  * 短链解析
  *
  * @note 用户通过入会短链获取对应的会议信息
  */
  virtual void ParseMeetingInfoUrl(const char* schema_url) = 0;


/**
   * 查询会议录制信息信息
   * @param meeting_id 会议id; period_id 周期会议的id，非周期会议传0; buf 输出buffer; len buf的长度
   * @note
  */
  virtual void QueryLocalRecordInfo(const char* meeting_id, const char* sub_meeting_id) = 0;

  /**
  /**

  * 一键批量邀请成员
  *
  * @note
  */
  virtual void AddUsersWithParam(const char* json_param) = 0;
  /**

  * @note 获取SDKAccountService的对象实例
  */
  virtual IAccountService* GetAccountService() = 0;
  
  /**
  * @note 获取IPremeetingService的对象实例
  */
  virtual IPreMeetingService* GetPreMeetingService() = 0;

  /**
  * @note 获取IInmeetingService的对象实例
  */
  virtual IInMeetingService* GetInMeetingService() = 0;

  /**
  * @note 获取IUserConfigService的对象实例
  */
  virtual IUserConfigService* GetUserConfigService() = 0;
};

#endif  /* ifndef WEMEET_SDK_H_ */
