//
//  TMSDKAccountService.h
//  TMSDK
//
//  Created by Tencent on 2021/7/16.
//

#import <Foundation/Foundation.h>
#import <TMSDK/TMSDKErrors.h>

@protocol TMSDKAccountDelegate <NSObject>

@optional

/**
 * @brief 账户登录的回调
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)onLogin:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief 退出会议事件结果回调
 * @param type 登出类型：1、手动登出；2、强制登出（同端登录被踢)
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)onLogout:(int)type code:(TMSDKError)code msg:(NSString *)msg;

/**
 * @brief 带登录态跳转事件结果回调
 * @param code 错误码
 * @param msg 错误信息
*/
- (void)onJumpUrlWithLoginStatus:(TMSDKError)code msg:(NSString *)msg;

@end

@interface TMSDKAccountService : NSObject

/// 设置回调代理AuthenticationCallback，重复调用会覆盖原有回调代理的值
@property (strong, nonatomic) id<TMSDKAccountDelegate> delegate;

/**
 * @brief 发起登录请求，登录结果会在回调 onLogin 返回
 * @param ssoUrl 单点登录的URL地址，由接入方的服务端生成并返回给接入方客户端
 如果该账号已在其他设备登录，是否强制将对方踢下线，如果传false，会登录失败，收到错误码kTMSDKErrorAccountAlreadyLogin
 */
- (void)login:(NSString *)ssoUrl;

- (void)login:(NSString *)loginUrl userName:(NSString *)userName passwd:(NSString *)passwd;

- (void)loginByCode:(NSString *)authCode userId:(NSString *)userId loginType:(TMLoginType)loginType;

- (void)loginByJSON:(NSString *)loginJSON;

/**
 * @brief 登出，登出结果会在回调AuthenticationCallback.onLogin返回
 */
- (void)logout;

/**
 * @brief 判断是否已登录
 * @return 是否已登录
 */
- (BOOL)isLoggedIn;


/**
 * @brief 带登录态跳转
 * @param targetUrl 要跳转的目标URL地址
 */
- (void)jumpUrlWithLoginStatus:(NSString *)targetUrl;

/**
 * @brief 获取带登录态的URL
 * @param target 要访问的URL地址
 * @return 带登录态的URL
 */
- (NSString *)getUrlWithLoginStatus:(NSString *)target;

@end
