//
//  TMSDK.h
//  TMSDK
//
//  Created by Tencent on 2021/7/13.
//

#import <Foundation/Foundation.h>
#import <TMSDK/TMSDKErrors.h>
#import <TMSDK/TMSDKAccountService.h>
#import <TMSDK/TMSDKPreMeetingService.h>
#import <TMSDK/TMSDKInMeetingService.h>
#import <TMSDK/TMSDKUserConfigService.h>

@protocol TMSDKDelegate <NSObject>

@optional

/**
 * @brief SDK 初始化的结果回调
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)onSDKInitializeResult:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief SDK 反初始化的结果回调
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)onSDKUninitializeResult:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief SDK遇到错误的全局回调函数
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)onSDKError:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief 打开日志回调
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)onShowLogsResult:(TMSDKError)code msg:(NSString *)msg;


/**
 * @brief SDK状态重置回调
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)OnResetSDKState:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief 用户操作的回调
 * @param actionType 操作类型码
 * @param param 参数信息
*/
- (void)OnHandleWemeetAction:(int)actionType param:(NSString *)param ;

/**
 * @brief 设置代理
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)onSetProxyResult:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief HandleSchema
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)onHandleSchemaResult:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief ParseMeetingInfoUrl
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)onParseMeetingInfoUrl:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief onAddUsersResult
 * @param code 错误码
 * @param msg 错误信息
 * @param userType 1——预定会议主持人 2——预定会议成员 3——会中添加会议成员
 */
- (void)onAddUsersResult:(int)userType code:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief onActiveUploadLogsResult
 * @param code 错误码
 * @param msg 错误信息
 */
- (void)onActiveUploadLogsResult:(TMSDKError)code msg:(NSString *)msg;
@end

@interface TMSDKInitParams : NSObject

@property (nonatomic, copy) NSString *sdkId;
@property (nonatomic, copy) NSString *sdkToken;
@property (nonatomic, copy) NSString *appName;
@property (nonatomic, copy) NSString *serverHost;
@property (nonatomic, copy) NSString *language;
@property (nonatomic, copy) NSString *proxyInfo;
@property (nonatomic, assign) BOOL allowHomeView;

@end

@interface TMSDK : NSObject

@property (weak, nonatomic) id<TMSDKDelegate> delegate;

/**
 * @brief 获取 TMSDK 单例
 * @return 当前运行的 SDK 单例
 */
+ (TMSDK *)shareSDK;

/**
 * @brief 初始化 SDK
 * @param initParams 初始化 SDK 所需要的的相关参数,具体参数参考 TMSDKInitParams
 * @param delegate 初始化回调代理对象
 */
- (void)initialize:(TMSDKInitParams *)initParams delegate:(id<TMSDKDelegate>)delegate;

/**
 * @brief  反初始化 SDK
 * @param param 反初始化 SDK 的json串
 * 例如：{"force": false}
 */
- (void)uninitialize:(NSString *)param;

/**
 * @brief 判断是否已初始化SDK成功
 * @return 是否已经初始化SDK
 */
- (BOOL)isInitialized;

/**
 * @brief 更新SDK Token，替换掉过期或快过期的SDK Token
 * @param newToken 新SDK Token
 * @return 处理结果的错误码
 */
- (TMSDKError)refreshSDKToken:(NSString *)newToken;

/**
 * @brief 获取当前SDK Token的值
 * @return 当前的SDK Token值
 */
- (NSString *)getCurrentSDKToken;

/**
 * @brief 获取当前SDK版本号
 * @return 版本号信息
 */
- (NSString *)getSDKVersion;

/**
 * @brief 设置回调代理
 * @param delegate 回调代理实例
 */
- (void)setCallback:(id<TMSDKDelegate>)delegate;

/**
 * @brief 打开日志文件夹
 */
- (void)showLogs;

/**
 * 显示SDK界面
 * @param params json字符串
 * @note 显示SDK界面
 */
- (void)showSDKView:(NSString *)params;

- (NSArray <NSString *>*)collectLogFiles:(uint64_t)beginTime
                             endTime:(uint64_t)endTime;

/**
* @brief 设置代理
* @param proxyInfo 代理信息的json串
  例如：{"enable":true,"agent_type":1,"protocol":"http","ip":"127.0.0.1","port":"8866","usename":"","password":""}
*/
- (void)setProxyInfo:(NSString *)proxyInfo;

/**
* @brief 查询代理
* @return 同setProxyInfo
* @note 初始化后查询代理
*/
- (NSString *)getProxyInfo;

/**
* @brief 带登录态链接入会
* @param schemaUrl 要访问的URL地址
*/
- (void)handleSchema:(NSString *)schemaUrl;

/**
 * @brief 用户通过入会短链获取对应的会议信息
 * @param schemaUrl 要访问的URL地址
*/
- (void)parseMeetingInfoUrl:(NSString *)schemaUrl;

/**
 * @brief 将SDK窗口置顶
 */
- (void)bringViewTop;

/**
 * @brief 添加人员
 */
- (void)addUsersWithParam:(NSString *)jsonParam;

/**
 * @brief 上传会议日志
 * @param beginTime 开始时间，时间戳ms
 * @param endTime 结束时间，时间戳ms
 * @param description 问题描述 
 */
- (void)activeUploadLogs:(uint64_t)beginTime
                 endTime:(uint64_t)endTime
             description:(NSString *)description;

#pragma mark - Service

/**
 * @brief 获取登录相关服务
 * @return 登录服务实例
 */
- (TMSDKAccountService *)getAccountService;

/**
 * @brief 获取会前相关服务
 * @return 会前服务实例
 */
- (TMSDKPreMeetingService *)getPreMeetingService;

/**
 * @brief 获取会中相关服务
 * @return 会中服务实例
 */
- (TMSDKInMeetingService *)getInMeetingService;

/**
 * @brief 获取用户配置相关服务
 * @return 用户配置实例
 */
- (TMSDKUserConfigService *)getUserConfigService;


@end
