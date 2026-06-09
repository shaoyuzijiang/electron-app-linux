//
//  TMSDKPreMeetingService.h
//  TMSDK
//
//  Created by Tencent on 2025/4/14.
//

#import <Foundation/Foundation.h>
#import <TMSDK/TMSDKErrors.h>

@interface TMSDKUserConfigService : NSObject

/**
 * @brief 设置用户配置。
 * @param configKey 配置项对应的key
 * @param configValue json格式配置的内容
 * @param complete 调用API接口时的回调
 */
- (void)setUserConfiguration:(NSString *)configKey configValue:(NSString *)configValue complete:(void(^__nullable)(TMSDKError, NSString * __nullable))complete;


/**
 * @brief 查询用户配置。
 * @param configKey 配置项对应的key
 * @param complete 调用API接口时的回调
 */
- (void)getUserConfiguration:(NSString *)configKey complete:(void(^__nullable)(TMSDKError, NSString * __nullable,  NSString * __nullable))complete;
@end

