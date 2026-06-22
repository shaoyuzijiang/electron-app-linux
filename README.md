# 腾讯会议 SDK Demo

基于 Electron + 腾讯会议 SDK 的桌面会议应用示例，支持加入会议、快速会议、预定会议、共享屏幕等功能。

## 功能特性

- SSO 登录 / 自动登录
- 加入会议、快速会议、预定会议、共享屏幕
- 会议列表展示
- macOS Apple Silicon (arm64) & Intel (x64) 双架构支持
- Windows x64 支持
- SDK 日志同时输出到控制台和文件，便于调试；日志时间戳使用本地时区
- Windows 控制台自动 UTF-8 编码，无中文乱码

## 环境要求

- Node.js >= 18
- Python 3（node-gyp 依赖）
- macOS：Xcode Command Line Tools
- Windows：Visual Studio Build Tools（需包含 C++ 桌面开发工作负载）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

`postinstall` 会自动编译当前平台的原生模块（macOS arm64 或 Windows x64）。

### 2. 启动开发

```bash
npm run dev
```

macOS 启动前会自动将 SDK Framework 拷贝到 Electron.app 中。Windows 需确保 SDK 运行时 DLL 在 `wemeet_sdk/win/x64/` 目录中。

## 项目结构

```
├── main.js                # Electron 主进程
├── preload.js             # 预加载脚本（IPC 桥接）
├── api.js                 # 后端 API 请求（RSA+AES 加密）
├── token-store.js         # Token 持久化存储
├── logger.js              # 文件日志模块（按小时滚动，本地时区时间戳）
├── start.js               # 启动前脚本（拷贝 SDK Framework，仅 macOS；Windows 设置控制台 UTF-8 编码）
├── binding.gyp            # node-gyp 原生模块编译配置
├── entitlements.mac.plist # macOS 权限声明
├── renderer/
│   ├── login.html         # 登录页
│   ├── index.html         # 会议主页
│   └── user-picker.html   # 选人组件（独立窗口）
├── wemeet_sdk/
│   ├── wemeet.cpp         # C++ 原生模块封装（N-API）
│   ├── jsoncpp.cpp        # JsonCpp 合并源文件
│   ├── mac/Frameworks/    # macOS SDK 动态库（arm64 / x64）
│   └── win/               # Windows SDK 文件
│       ├── include/       # SDK C++ 头文件
│       ├── lib/x64/release/ # SDK 链接库（.lib）
│       └── x64/           # Windows 编译产物（.node + SDK 运行时 DLL + Release 目录）
│           └── copy.bat   # SDK 文件一键拷贝脚本
├── output/
│   └── mac/               # macOS 编译产物（.node 原生模块）
└── include/               # C++ 公共头文件（JsonCpp 等）
```

## 构建原生模块

### macOS

```bash
# 仅编译 arm64 架构
npm run build:native:mac-arm64

# 编译 Intel 架构（需要 Rosetta 2）
npm run build:native:mac-x64

# 同时编译双架构
npm run build:native:mac
```

> Intel 架构编译需要 Rosetta 2，如未安装请执行：
> ```bash
> softwareupdate --install-rosetta
> ```

### Windows

```bash
# 编译 Win x64 原生模块
npm run build:native:win-x64
```

编译产物输出到 `wemeet_sdk/win/x64/`，包含 `.node` 文件。SDK 运行时 DLL 和 `Release` 目录需放置在同目录中。

#### 拷贝 SDK 运行时文件

从腾讯会议 SDK Windows 分发包拷贝运行时文件到 `wemeet_sdk/win/x64/`：

```bat
cd wemeet_sdk\win\x64
copy.bat
```

`copy.bat` 会从 `SDK_SRC` 路径拷贝以下内容：
- `*.dll` — SDK 运行时 DLL（`wemeetsdk_x64.dll`、`wemeet_base.dll`、VC 运行时等）
- `wemeetsdk_x64.lib` — 链接库（同步到 `wemeet_sdk/win/lib/x64/release/`）
- `Release\` — SDK 模块、插件、资源等目录
- `wemeet_electron_sdk.node` — 编译后的原生模块

> 使用前需修改 `copy.bat` 中的 `SDK_SRC` 变量指向实际的 SDK 分发包路径。

## 打包安装包

### macOS

```bash
# 按架构打包
npm run dist:mac:arm64       # Apple Silicon 专用
npm run dist:mac:x64         # Intel 专用
npm run dist:mac:universal   # 通用二进制（同时支持两种架构）

# 快捷打包当前平台
npm run dist
```

### Windows

```bash
# 打包 Windows x64 安装包（NSIS）
npm run dist:win:x64

# 快捷打包当前平台
npm run dist
```

打包产物输出到 `dist/` 目录。macOS 生成 `.dmg`，Windows 生成 `.exe`（NSIS 安装包）。

### 打包完整流程

```bash
# macOS
npm run build:native:mac && npm run dist:mac:universal

# Windows
npm run build:native:win-x64 && npm run dist:win:x64
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发模式 |
| `npm run build:native:mac-arm64` | 编译 macOS arm64 原生模块 |
| `npm run build:native:mac-x64` | 编译 macOS x64 原生模块 |
| `npm run build:native:mac` | 编译 macOS 双架构原生模块 |
| `npm run build:native:win-x64` | 编译 Windows x64 原生模块 |
| `npm run dist` | 打包当前平台安装包 |
| `npm run dist:mac:arm64` | 打包 macOS arm64 安装包 |
| `npm run dist:mac:x64` | 打包 macOS x64 安装包 |
| `npm run dist:mac:universal` | 打包 macOS 通用安装包 |
| `npm run dist:win:x64` | 打包 Windows x64 安装包（NSIS） |
| `npm run pack` | 仅打包目录（不生成安装包） |

## 注意事项

### macOS

- 未签名/未公证的 `.dmg` 在其他 Mac 上打开时会被 Gatekeeper 拦截，需右键 → 打开，或执行 `xattr -cr <app路径>` 去除隔离属性
- SDK Framework 在开发模式下通过 `start.js` 自动拷贝到 Electron.app 中，打包时通过 `extraResources` 自动处理

### Windows

- SDK 运行时 DLL（`wemeetsdk_x64.dll` 等）需放置在 `wemeet_sdk/win/x64/` 目录中，主进程会自动将该目录加入 `PATH` 环境变量
- SDK 的 `Release` 目录（含 modules、plugins、resources 等）需放置在 `wemeet_sdk/win/x64/Release/`，与 `wemeet_electron_sdk.node` 同级
- 可使用 `wemeet_sdk/win/x64/copy.bat` 一键拷贝 SDK 运行时文件
- 打包时通过 `build.win.extraResources` 自动将 `wemeet_sdk/win/x64/` 目录下所有文件包含到安装包中（无 filter 限制，确保 SDK 资源完整）
- 编译原生模块需要 Visual Studio Build Tools（C++ 桌面开发工作负载）
- 启动时自动设置控制台为 UTF-8 编码（`chcp 65001`），解决中文乱码
- SDK 内部日志同时输出到控制台（`stderr`）和日志文件，便于调试
- SDK 回调格式：当 `code=0` 且 `msg` 为空时，回调 JSON 中省略 `code`/`msg` 字段，此时应视为成功

### Universal 构建说明（macOS）

Universal 构建会将 arm64 和 x64 两个架构的 app 合并为一个通用二进制，需注意以下几点：

1. **原生模块需双架构编译**：运行 `npm run build:native:mac` 生成 arm64 和 x64 两个 `.node` 文件，`dist:mac:universal` 会自动通过 `lipo -create` 将它们合并为通用二进制
2. **SDK Framework 符号链接**：`wemeet_sdk/mac/Frameworks/x64/TMSDK.framework` 必须是**相对符号链接**（`../arm64/TMSDK.framework`），不能是绝对路径符号链接，否则 `@electron/universal` 合并时因路径不一致会报 mach-o mismatch 错误
3. **架构特定 .node 文件已排除**：`package.json` 的 `files` 配置中排除了 `wemeet_electron_sdk.arm64.node` 和 `wemeet_electron_sdk.x64.node`，只保留合并后的通用 `wemeet_electron_sdk.node`

### 更新 SDK 包

当需要替换新版腾讯会议 SDK 时，请按以下步骤操作：

1. **替换 SDK 文件**：
   - macOS：将新 SDK 的 `wemeet_sdk/mac/` 目录替换
   - Windows：将新 SDK 的头文件复制到 `wemeet_sdk/win/include/`，`.lib` 文件复制到 `wemeet_sdk/win/lib/x64/release/`，运行时 DLL 和 `Release` 目录复制到 `wemeet_sdk/win/x64/`（可使用 `wemeet_sdk/win/x64/copy.bat`，修改其中的 `SDK_SRC` 路径后执行）
2. **替换 C++ 封装**：将新 SDK Electron Demo 的 `wemeet_sdk/wemeet.cpp` 和 `wemeet_sdk/jsoncpp.cpp` 替换到项目
3. **检查 macOS 符号链接**：确保 `wemeet_sdk/mac/Frameworks/x64/TMSDK.framework` 是**相对符号链接**，而非绝对路径符号链接。替换后执行以下命令检查和修复：
   ```bash
   readlink wemeet_sdk/mac/Frameworks/x64/TMSDK.framework
   
   # 如果输出是绝对路径（以 / 开头），需修复为相对路径：
   cd wemeet_sdk/mac/Frameworks/x64
   rm TMSDK.framework
   ln -s ../arm64/TMSDK.framework TMSDK.framework
   cd -
   ```
4. **重新编译原生模块**：SDK 更新后需要重新编译 `.node` 原生模块：
   ```bash
   # macOS
   npm run build:native:mac

   # Windows
   npm run build:native:win-x64
   ```
5. **验证**：运行 `npm run dev` 确认 SDK 加载正常后再打包

## SDK API 列表

### 基础接口

| API | 说明 |
|-----|------|
| `Init(sdkId, token)` | SDK 初始化 |
| `Login(ssoUrl)` | SSO 登录 |
| `Logout()` | 登出 |
| `JoinMeeting(meetingCode, displayName, password)` | 加入会议 |
| `JoinMeetingByJson(meetingJson)` | 通过 JSON 参数加入会议 |
| `QuickMeeting()` | 快速会议 |
| `LeaveMeeting(leaveType)` | 离开会议 |
| `GetSDKVersion()` | 获取 SDK 版本 |

### 会前界面

| API | 说明 |
|-----|------|
| `ShowPreMeetingView(uiStyle, tabId)` | 显示会前界面（Home 页） |
| `ShowJoinMeetingView()` | 显示加入会议界面 |
| `ShowScheduleMeetingView(meetingType)` | 显示预定会议界面 |
| `ShowMeetingSettingView()` | 显示设置界面 |

### 会中界面

| API | 说明 |
|-----|------|
| `ShowScreenCastView()` | 显示投屏页面 |
| `ShowScreenShareView()` | 显示屏幕共享视图 |
| `ShowHistoricalMeetingView()` | 显示历史会议 |
| `ShowMeetingDetailView(meetingId, subMeetingId, ...)` | 显示会议详情 |
| `ShowVoiceRecordView()` | 显示录音笔窗口 |
| `ShowAIAssistantView()` | 显示 AI 小助手 |
| `BringInMeetingViewTop()` | 会中窗口置顶 |
| `ManipulateWindow(action)` | 会中窗口操作 |
| `SwitchLayout(layoutJson)` | 切换会中布局 |

### 状态查询

| API | 说明 |
|-----|------|
| `IsInitialized()` | 查询是否已初始化 |
| `IsAuthorized()` | 查询是否已登录 |
| `GetCurrentSDKToken()` | 获取当前 SDK Token |
| `RefreshSDKToken(newToken)` | 刷新 SDK Token |
| `GetCurrentMeetingInfo()` | 获取当前会议信息 |
| `GetScreenShareInfo()` | 获取屏幕共享信息 |
| `GetMeetingWindowInfo()` | 获取会中窗口位置信息 |

### 字幕

| API | 说明 |
|-----|------|
| `SwitchCaption(open)` | 开关字幕 |
| `UpdateCaptionSettings(settingsJson)` | 更新字幕设置 |

### 配置与代理

| API | 说明 |
|-----|------|
| `SetUserConfiguration(userKey, userConfig)` | 设置用户配置 |
| `GetUserConfiguration(userKey)` | 获取用户配置 |
| `SetProxyInfo(proxyInfo)` | 设置代理 |
| `GetProxyInfo()` | 获取代理信息 |

### 回调控制

| API | 说明 |
|-----|------|
| `EnableInviteUsersCallback(enable, show)` | 开启邀请回调 |
| `SetNeedShareCallback(enable, show)` | 开启分享回调 |
| `EnableAddressBookCallback(enable, show)` | 开启通讯录回调 |
| `SetNeedMeetingInfoCallback(enable, show)` | 开启会议信息回调 |
| `SubscribeInMeetingActionEvent(actionType, subscribe, subscriptionJson)` | 订阅会中 Action 事件 |
| `EnableRingInvitationView(enable)` | 开启响铃邀请界面 |
| `HandleRingInvitation(accept, inviteId)` | 处理响铃邀请 |

### 其他

| API | 说明 |
|-----|------|
| `AddUsersWithParam(jsonParam)` | 添加用户（邀请入会） |
| `EnableCustomOrgInfo(enable)` | 开启自定义组织信息 |
| `SetCustomOrgInfo(jsonParam)` | 设置自定义组织信息 |
| `Login(ssoUrl)` | SSO URL 登录（非 JSON 方式） |
| `JumpUrlWithLoginStatus(url)` | 带登录状态跳转 URL |
| `GetUrlWithLoginStatus(url)` | 获取带登录状态的 URL |
| `ShowUploadLogsView()` | 上传日志 |
