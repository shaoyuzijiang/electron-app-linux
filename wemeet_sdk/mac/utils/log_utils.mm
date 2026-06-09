#import "log_utils.h"
#import <Foundation/Foundation.h>

std::string GetSandboxLibraryPath() {
    NSArray *paths = NSSearchPathForDirectoriesInDomains(NSLibraryDirectory, NSUserDomainMask, YES);
    NSString *libDirectory = [paths objectAtIndex:0];
    if ([libDirectory containsString:@"Containers"]) {
        return libDirectory.UTF8String;
    } else {
        NSString *fateSandboxDirectory = [NSString stringWithFormat:@"%@/Containers/%@/Data/Library", libDirectory, [[[NSBundle mainBundle] infoDictionary] objectForKey:@"CFBundleIdentifier"]];
        return fateSandboxDirectory.UTF8String;
    }
}
