# 腾讯会议 SDK Linux ARM64 Electron Demo 开发文档

> 文档状态：设计确认稿  
> 目标项目：`<项目根目录>`  
> 参考项目：`<只读参考工程目录>`（仅参考，不直接复制工程）  
> SDK 基线：Linux ARM64 `3.26.100.14`  
> 首期交付：Ubuntu 22.04 LTS ARM64 / X11 / AppImage

## 1. 文档目的

本文档用于指导重新开发一个独立的 Linux ARM64 Electron 演示程序，展示腾讯会议 Linux SDK 当前实际支持的会议能力。

开发原则：

1. 以 Linux ARM64 正式 SDK 包的实际接口和运行资源为准。
2. Linux SDK 缺失的能力不开发、不在主操作界面展示。
3. 不要求与 macOS/Windows SDK 的接口数量完全一致。
4. 现有 macOS/Windows 工程仅用于参考 Electron 架构、鉴权流程和交互方式。
5. 不从现有工程整体复制代码，重新建立清晰、可维护的 Linux 工程。
6. SDK Secret、ID Token 私钥等签名材料只能存在于服务端。
7. 首期优先保证 Ubuntu ARM64 + X11 可运行，再进行 Wayland 冒烟验证。

---

## 2. 依据与优先级

### 2.1 官方公开资料

1. 腾讯会议 SDK GitHub 仓库  
   <https://github.com/Tencent-Meeting/TencentMeetingSDK/tree/main>

2. Linux 文档目录  
   <https://github.com/Tencent-Meeting/TencentMeetingSDK/tree/main/Docs/Linux>

3. Linux SDK 接入手册  
   <https://github.com/Tencent-Meeting/TencentMeetingSDK/blob/main/Docs/Linux/Linux%E6%8E%A5%E5%85%A5%E6%89%8B%E5%86%8C.md>

4. Linux 线程同步说明  
   <https://github.com/Tencent-Meeting/TencentMeetingSDK/blob/main/Docs/Linux/Linux%E7%BA%BF%E7%A8%8B%E5%90%8C%E6%AD%A5.md>

5. Linux 接入 FAQ  
   <https://github.com/Tencent-Meeting/TencentMeetingSDK/blob/main/Docs/Linux/%E6%8E%A5%E5%85%A5%E9%97%AE%E9%A2%98FAQ.md>

6. Electron Linux 接入手册  
   <https://github.com/Tencent-Meeting/TencentMeetingSDK/blob/main/Docs/Electron/Electron%E6%8E%A5%E5%85%A5%E6%89%8B%E5%86%8C-Linux.md>

7. SDK 鉴权与登录说明  
   <https://github.com/Tencent-Meeting/TencentMeetingSDK/blob/main/Docs/Common/SDK%E9%89%B4%E6%9D%83%E4%B8%8E%E7%99%BB%E5%BD%95%E8%AF%B4%E6%98%8E.md>

8. SaaS SDK 特性更新列表  
   <https://cloud.tencent.com/developer/article/2297237>

9. SDK 项目交付指导  
   <https://cloud.tencent.com/developer/article/2297229>

### 2.2 本地正式包

```text
<授权 SDK 下载目录>/
└── TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz
```

已确认包内关键文件均为 ELF64 AArch64：

```text
Electron_Demo/output/linux/wemeet_electron_sdk.node
SDK/libwemeetsdk.so
SDK/libwemeet_base.so
```

包内包含：

```text
Electron_Demo/
├── readme.md
├── package.json
├── binding.gyp
├── configure.sh
├── copy_sdk_build_linux.sh
├── output/linux/wemeet_electron_sdk.node
└── wemeet_sdk/wemeet.cpp

SDK/
├── include/
├── libwemeetsdk.so
├── libwemeet_base.so
├── saas_sdk_env.json
└── Release/
    ├── lib/
    ├── plugins/
    ├── modules/
    ├── nxui/
    └── x11-wayland/
```

### 2.3 依据优先级

当不同资料不一致时，按以下优先级处理：

1. `3.26.100.14` 正式包中的二进制、头文件和 `wemeet.cpp`；
2. 正式包内 `Electron_Demo/readme.md` 和构建脚本；
3. GitHub 对应 Linux/Electron 接入文档；
4. GitHub `main` 分支中的最新示例；
5. 现有 macOS/Windows Demo 的实现方式。

禁止将 GitHub `main` 分支中新版本接口直接套用到 `3.26.100.14` 二进制。

---

## 3. 范围定义

### 3.1 首期目标

开发一个独立 Electron Demo，完成以下闭环：

```text
业务账号登录
→ 获取 SDK ID/SDK Token
→ 初始化 SDK
→ 获取 ID Token/SSO URL
→ 登录腾讯会议 SDK
→ 调用 Linux 支持的会议接口
→ 接收并展示 SDK 回调
→ 登出和异步反初始化
→ 打包为 ARM64 AppImage
```

### 3.2 不在首期范围内

以下功能不属于本 Demo 的目标：

- IM 即时通讯；
- 日程系统；
- 企业管理 WebView；
- 管理后台；
- 自定义通讯录；
- 自定义会中选人；
- Linux SDK 当前不支持或官方 Demo 明确过滤的接口；
- x86/x64 Linux；
- LoongArch；
- Windows 和 macOS 打包；
- 自动更新服务；
- 与现有项目合仓；
- deb/rpm 安装包。

---

## 4. 目标平台

### 4.1 首期测试基线

| 项目 | 选择 |
|---|---|
| 操作系统 | Ubuntu 22.04 LTS ARM64 |
| CPU | AArch64 / ARM64 |
| 桌面会话 | X11/Xorg 为主 |
| Wayland | 冒烟测试，不作为首期完整验收环境 |
| 摄像头 | 必须测试 |
| 麦克风 | 必须测试 |
| 显示器 | 单显示器为首期基线 |
| 交付格式 | ARM64 AppImage |

### 4.2 官方已测试范围

Linux 官方接入手册列出的环境包括：

- Ubuntu 18.04 及以上；
- 统信 UOS V20；
- Deepin V20；
- 麒麟 V10；
- CPU 支持 X86、X64、ARM64、LoongArch。

首期只对 Ubuntu 22.04 ARM64 做完整验收。UOS 和麒麟在客户明确需要时补充测试。

### 4.3 X11/Wayland 策略

采用以下原则：

1. X11 是首期正式演示环境。
2. Wayland 环境首先尝试 SDK 包自带的 `Release/x11-wayland/x11-ext.sh`。
3. 如果环境要求切换到 XWayland，则设置 SDK 子进程需要的环境，而不是修改系统全局配置。
4. 不默认向 `/opt` 写入系统级补丁。
5. 不默认使用 `--no-sandbox` 启动 Electron。
6. Wayland 下无法稳定工作的窗口定位、置顶等能力不纳入首期验收。

---

## 5. 项目路径

### 5.1 项目根目录

```text
<项目根目录>
```

该目录与现有项目平级，确保两个工程完全独立。

### 5.2 SDK 包来源

开发阶段默认从以下路径导入：

```text
<授权 SDK 下载目录>/
TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz
```

导入脚本不能将该绝对路径写死到业务代码。脚本通过参数或环境变量接收：

```text
TMSDK_PACKAGE_PATH
```

### 5.3 SDK 源文件保存位置

```text
electron-app-linux/sdk/linux-arm64/3.26.100.14/
├── include/
├── libwemeetsdk.so
├── libwemeet_base.so
├── saas_sdk_env.json
└── Release/
```

### 5.4 运行时暂存位置

```text
electron-app-linux/output/linux-arm64/
├── wemeet_electron_sdk.node
├── libwemeetsdk.so
├── libwemeet_base.so
├── saas_sdk_env.json
└── Release/
```

`.node`、两个顶层 `.so` 和 `Release/` 必须保持同级。

### 5.5 安装包内位置

```text
resources/tmsdk/linux-arm64/
├── wemeet_electron_sdk.node
├── libwemeetsdk.so
├── libwemeet_base.so
├── saas_sdk_env.json
└── Release/
```

所有原生文件位于 ASAR 外部。

---

## 6. 技术栈

| 类型 | 选择 |
|---|---|
| 桌面框架 | Electron `33.4.11` 首选 |
| Node.js | Node.js 18+，构建时使用与 Electron 工具链兼容版本 |
| UI | 原生 HTML/CSS/JavaScript |
| 原生桥接 | C++ + N-API + node-gyp |
| 打包 | electron-builder |
| 安装包 | AppImage ARM64 |
| 测试 | Node 内置测试或轻量单元测试 + 实机手工验收 |

选择原生 HTML/CSS/JavaScript 的原因：

- 与当前 Demo 结构接近；
- 不引入额外前端构建框架；
- Demo 功能以 SDK 调用和状态展示为主；
- 减少 Linux ARM64 构建变量。

### 6.1 Electron 版本策略

正式包自带 Demo 使用 Electron `17.4.11`，当前参考项目使用 Electron `33.4.11`。

实施顺序：

1. 使用正式包配套 `wemeet.cpp` 和头文件；
2. 在 Linux ARM64 上针对 Electron `33.4.11` 重新编译 addon；
3. 验证加载、初始化、回调和反初始化；
4. 如果确认 Electron 33 与该 SDK 版本不兼容，再用 Electron `17.4.11` 做官方基线对照；
5. Electron 17 只用于定位兼容问题，不默认作为最终版本。

---

## 7. 总体架构

```text
Renderer
  │
  │ window.meetingDemo（白名单 API）
  ▼
Preload
  │
  │ IPC invoke / event
  ▼
Main Process
  ├── AuthService
  ├── SDKService
  ├── SDKCapabilityService
  ├── LinuxRuntimeService
  ├── DiagnosticsService
  └── Logger
        │
        ▼
  wemeet_electron_sdk.node
        │
        ▼
  libwemeetsdk.so / libwemeet_base.so
        │
        ▼
  Release/ Qt、插件、SDK 子进程和资源
```

### 7.1 安全边界

- `contextIsolation: true`；
- `nodeIntegration: false`；
- `sandbox: true`，若 SDK 集成确认与主窗口 sandbox 冲突，再基于最小范围调整；
- Renderer 不直接访问 Node、文件系统或原生 addon；
- Renderer 不接触 SDK Token、ID Token、Refresh Token 和完整 SSO URL；
- 所有 SDK 调用经 `SDKService`；
- 所有 IPC 参数进行类型、长度和枚举校验；
- IPC 校验发送方 URL/Frame；
- 日志统一脱敏。

---

## 8. 模块划分

```text
electron-app-linux/
├── package.json
├── binding.gyp
├── main.js
├── DEVELOPMENT.md
├── README.md
├── src/
│   ├── main/
│   │   ├── app-lifecycle.js
│   │   ├── window-manager.js
│   │   ├── ipc/
│   │   │   ├── register-ipc.js
│   │   │   ├── validate-sender.js
│   │   │   └── schemas.js
│   │   ├── auth/
│   │   │   ├── auth-service.js
│   │   │   ├── credential-provider.js
│   │   │   └── token-store.js
│   │   ├── sdk/
│   │   │   ├── sdk-service.js
│   │   │   ├── sdk-loader.js
│   │   │   ├── sdk-state.js
│   │   │   ├── sdk-capabilities.js
│   │   │   ├── callback-parser.js
│   │   │   ├── sdk-errors.js
│   │   │   └── linux-runtime.js
│   │   └── logging/
│   │       └── logger.js
│   ├── preload/
│   │   └── preload.js
│   └── renderer/
│       ├── index.html
│       ├── css/
│       └── js/
│           ├── app.js
│           ├── auth.js
│           ├── sdk-status.js
│           ├── meeting.js
│           ├── diagnostics.js
│           └── callback-log.js
├── native/
│   ├── wemeet.cpp
│   └── json/
├── sdk/
│   └── linux-arm64/
│       └── 3.26.100.14/
├── output/
│   └── linux-arm64/
├── scripts/
│   ├── import-sdk.js
│   ├── verify-sdk.js
│   ├── build-native.js
│   ├── verify-runtime.js
│   └── package-linux.js
└── tests/
    ├── callback-parser.test.js
    ├── sdk-state.test.js
    └── sdk-capabilities.test.js
```

### 8.1 `linux-runtime.js`

负责：

- 检查 `process.platform === 'linux'`；
- 检查 `process.arch === 'arm64'`；
- 区分开发态和打包态路径；
- 检查 `.node`、`.so`、`saas_sdk_env.json`、`Release/`；
- 检查关键 helper 的执行权限；
- 检查符号链接是否完整；
- 识别 `XDG_SESSION_TYPE`；
- 准备 SDK 子进程的 `PATH`、`LD_LIBRARY_PATH` 和 `QT_PLUGIN_PATH`；
- 加载并解析可信的 X11/Wayland 环境脚本；
- 在 SDK 加载前完成全部准备工作；
- 返回可展示的诊断结果。

### 8.2 `sdk-loader.js`

负责：

- 加载 ARM64 `.node`；
- 获取 addon 导出方法；
- 获取 SDK 版本；
- 检查运行时版本是否符合预期；
- 将原生加载错误转成可理解的诊断信息。

### 8.3 `sdk-service.js`

唯一允许调用原生 SDK 的业务模块，负责：

- 初始化和登录并发锁；
- SDK 状态机；
- 登录前回调配置；
- 会议 API；
- 回调分发；
- 超时和错误映射；
- 登出；
- 异步反初始化；
- 应用退出协调。

### 8.4 `sdk-capabilities.js`

能力由三层交集决定：

```text
Linux 3.26 静态支持表
∩ 正式包官方 Linux 排除表
∩ addon 运行时实际导出方法
```

Renderer 只接收布尔能力信息，不直接获取 addon 导出对象。

### 8.5 `credential-provider.js`

提供统一鉴权接口：

- 默认：从现有后端获取凭证；
- 调试：内存临时输入凭证；
- 不在客户端生成 SDK Token 或 ID Token。

---

## 9. SDK 生命周期

状态定义：

```text
UNLOADED
RUNTIME_READY
LOADED
INITIALIZING
INITIALIZED
LOGGING_IN
LOGGED_IN
LOGGING_OUT
UNINITIALIZING
RELEASED
ERROR
```

正常流程：

```text
启动
→ prepareRuntime
→ loadAddon
→ AddJsCallback
→ requestSdkToken
→ InitWemeetSDK
→ OnSDKInitializeResult
→ 配置登录前回调
→ requestSsoUrl
→ Login
→ OnLogin
→ 允许会议操作
```

### 9.1 初始化

初始化参数至少包括：

- SDK ID；
- SDK Token；
- 可写的 UTF-8 `data_path`；
- 应用名称；
- 应用图标；
- 语言。

初始化成功以 `OnSDKInitializeResult` 回调为准，不以函数调用返回为准。

### 9.2 登录

Linux `3.26.100.14` 使用该版本实际提供的 `Login`，不使用当前 macOS/Windows 3.43 的 `LoginByJSON`。

登录成功以 `OnLogin` 回调为准。

### 9.3 退出

```text
阻止新 SDK 请求
→ 如有会议则按策略离会
→ Logout
→ UninitWemeetSDK({"force": true})
→ 等待 OnSDKUninitializeResult
→ 释放原生回调资源
→ 关闭窗口和日志
→ app.quit()
```

`UninitWemeetSDK` 是异步操作，必须有超时兜底，但不能调用后立即销毁 addon 或结束进程。

---

## 10. Linux 线程模型

官方文档说明：

- SDK 运行在独立线程；
- 默认回调发生在 SDK 线程；
- `IThreadDispatcher::SyncRunOnMainThread` 要求同步执行传入的 `runnable`；
- 方法返回前，`runnable(user_data)` 必须执行完成。

Electron/N-API 适配要求：

1. 不从 SDK 子线程直接调用普通 N-API；
2. 使用线程安全机制把数据送到 Node 事件循环；
3. 如果实现 `IThreadDispatcher`，必须满足同步契约，不能只入队后立即返回；
4. 主线程回调中不能反向等待 SDK 线程，避免死锁；
5. 退出时先停止 SDK 回调，再释放 TSFN、N-API 引用和 dispatcher；
6. 正式实现前先审查包内 `wemeet.cpp` 的 threadsafe function 生命周期。

首期优先使用正式包配套的桥接实现，在不改变 SDK ABI 的前提下修复明确的资源释放和错误处理问题。

---

## 11. 鉴权设计

正常 Linux 客户端必须与现有 macOS/Windows 客户端保持同一业务登录体验。用户只输入业务账号和密码；不会手工输入 SDK ID、SDK Token、ID Token，也不会拼接 SSO URL。构建、SDK 导入和原生 POC 阶段不获取任何业务登录信息。

### 11.1 固定登录时序

```text
用户输入业务账号密码
→ 后端业务登录
→ 获取 Access Token / Refresh Token
→ 获取 SDK ID / SDK Token
→ InitWemeetSDK
→ 等待 OnSDKInitializeResult
→ 获取 ID Token / SSO URL
→ Linux SDK Login
→ 等待 OnLogin
→ 进入会议功能页面
```

所有后端请求和 SDK 凭证处理只位于主进程。Renderer 只能获得脱敏后的业务登录状态、展示资料和 SDK 生命周期状态。

### 11.2 服务端职责

服务端保存 SDK ID、SDK Secret、ID Token 私钥以及业务用户与腾讯会议用户映射。服务端负责验证业务身份、签发 SDK Token 和 ID Token、生成完整 SSO URL、刷新及撤销业务会话。

SDK Secret、私钥、Access Token、Refresh Token、SDK Token、ID Token 和完整 SSO URL 均不得进入 Renderer、日志、诊断快照或 Electron 安装包。

### 11.3 后端接口契约

后续客户端固定使用与 macOS/Windows 一致的接口；服务端基地址必须由受信任发布配置提供，不能来自 Renderer 或用户输入：

| 方法 | 接口 | 主进程用途 |
|---|---|---|
| GET | `/api/auth/public-key` | 获取业务登录加密公钥与轮换标识 |
| POST | `/api/auth/login` | 提交加密业务登录信封，建立业务会话 |
| POST | `/api/auth/refresh` | 刷新并轮换业务 Access/Refresh Token |
| GET | `/api/auth/profile` | 获取脱敏的当前用户展示资料 |
| GET | `/api/auth/sdk-token` | 按已认证业务用户获取短期 SDK ID/SDK Token |
| GET | `/api/auth/id-token` | 按已认证业务用户获取短期 SDK 登录材料（ID Token/SSO URL） |
| POST | `/api/auth/logout` | 撤销当前业务会话及 Refresh Token |

现阶段只在 `src/main/auth/auth-contract.js` 固化接口路径、访问要求、HTTPS 基地址限制与时序；不发起真实网络请求，不接收任何真实账号或凭证。

### 11.4 客户端模块边界

```text
Renderer（业务账号密码短暂输入）
  → preload 白名单 IPC
  → Main Process
      ├─ AuthApiClient：固定 HTTPS 服务地址、超时、响应上限和错误映射
      ├─ TokenStore：仅业务 Access/Refresh Token 的安全存储
      ├─ AuthService：登录、刷新、Profile、SDK 初始化/登录材料获取
      └─ SDKService：AddJsCallback、初始化/登录/退出回调编排
```

`AuthApiClient` 不接受 Renderer 传入的 URL、请求头或方法名。`TokenStore` 仅在系统安全存储可用时持久化 Access/Refresh Token；否则退回内存会话，绝不明文落盘。SDK Token、ID Token 和完整 SSO URL 只在主进程内存的单次调用范围内存在，使用后立即丢弃。

### 11.5 回调与退出要求

初始化、SDK 登录和反初始化必须分别等待 `OnSDKInitializeResult`、`OnLogin` 和 `OnSDKUninitializeResult` 成功回调，不能以 addon 函数返回替代回调结果。SDK Token 过期时，主进程经已认证业务会话重新获取 SDK Token 并调用同版本 SDK 的刷新接口；该过程不通知 Renderer 任何敏感材料。

退出顺序固定为：停止新 SDK 请求 → 离会（如适用）→ SDK Logout → 后端 `/api/auth/logout` → 异步 UninitWemeetSDK → 清除业务安全存储。任何一步日志均不得包含凭证或完整 SSO URL。

### 11.6 POC 例外

`poc:linux-arm64` 可使用当前 shell 的临时环境变量验证原生初始化/反初始化，且仅用于 Linux ARM64 技术验证。它不是正常登录路径，不能成为正式 UI、Token 存储或后端鉴权方案的一部分。

---

## 12. 功能清单

### 12.1 环境和状态

- 平台/架构信息；
- Electron、Node、N-API 版本；
- X11/Wayland 信息；
- SDK 文件检查；
- SDK 加载状态；
- SDK 版本；
- 初始化状态；
- 登录状态；
- 回调时间线；
- 诊断信息复制。

### 12.2 SDK 生命周期

- 初始化；
- 登录；
- 登录态查询；
- 登出；
- 反初始化；
- SDK Token 获取和刷新；
- 错误回调展示。

### 12.3 会议能力

以 addon 实际导出并经 Linux 支持表确认的接口为准，首期优先覆盖：

- 加入会议；
- JSON 参数入会；
- 快速会议；
- JSON 参数快速会议；
- 离开会议；
- 会前主页；
- 加入会议页；
- 预定会议页；
- 会议设置；
- 历史会议；
- 会议详情；
- 当前会议信息；
- 会中窗口信息；
- 会中窗口置顶；
- 窗口操作；
- 字幕开关；
- 字幕设置；
- 布局切换；
- 屏幕共享信息查询；
- 代理配置；
- 会议链接解析；
- Scheme 处理；
- 日志目录、日志收集和上传；
- 响铃邀请；
- 会中 Action 事件订阅；
- 自定义组织信息。

### 12.4 明确不开发、不展示的能力

官方 `3.26.100.14` Electron Demo 对 Linux 明确过滤：

- `EnableAddressBookCallback`
- `EnableInviteUsersCallback`
- `ShowScreenCastView`
- `AddUsersWithParam`
- `QueryLocalRecordInfo`
- `ShowRecordFolder`
- `Transcode`
- `DecodeUltrasoundScreenCastCode`
- `StartScreenCast`

当前 Linux 包相对 macOS/Windows 3.43 还缺少：

- `LoginByJSON`
- `DiscoverNearScreenCastCode`
- `ShowScreenShareView`
- `ShowVoiceRecordView`
- `ShowAIAssistantView`
- `ShowRoomsControllerView`
- `SetUserConfiguration`
- `GetUserConfiguration`
- `SetAppearanceMode`
- `GetAppearanceMode`

这些功能不创建按钮、不注册业务 IPC、不提供占位实现。

能力模块仍保留内部版本映射，以便未来 SDK 升级后新增功能。

---

## 13. UI 设计

建议采用单窗口侧边栏结构：

```text
┌───────────────────────────────────────────────┐
│ 腾讯会议 SDK Linux ARM64 Demo                │
├──────────────┬────────────────────────────────┤
│ 运行状态     │ 当前功能面板                   │
│ 初始化/登录  │                                │
│ 会议         │                                │
│ 会中控制     │                                │
│ SDK 配置     │                                │
│ 回调日志     │                                │
│ 环境诊断     │                                │
└──────────────┴────────────────────────────────┘
```

页面规则：

- SDK 未加载时只允许查看诊断；
- SDK 未初始化时禁用登录和会议操作；
- SDK 未登录时禁用需要授权的会议操作；
- 已入会状态下才显示会中控制；
- 不支持的能力完全不展示；
- 操作结果统一显示成功、失败、错误码和可重试建议；
- 回调日志隐藏 Token、密码和完整 SSO URL。

---

## 14. 错误处理

### 14.1 错误分类

| 分类 | 示例 | 处理策略 |
|---|---|---|
| 环境错误 | 非 ARM64、无桌面会话 | 阻止加载 SDK，展示诊断 |
| 资源错误 | 缺 `.so`、缺 `Release`、权限丢失 | 阻止加载并指出具体文件 |
| ABI 错误 | addon 架构或 Electron ABI 不匹配 | 阻止加载，输出架构和版本 |
| 初始化错误 | SDK Token、data path、子进程启动失败 | 展示 SDK code/msg，允许有限重试 |
| 登录错误 | SSO URL 无效、ID Token 过期 | 重新向服务端获取登录材料 |
| 会议错误 | 会议号、密码、权限错误 | 展示业务错误，不重启 SDK |
| 退出错误 | 反初始化超时 | 记录日志，超时后安全兜底退出 |

### 14.2 重试规则

允许自动重试：

- 短暂网络错误；
- SDK Token/ID Token 获取失败；
- 系统休眠恢复后的重连；
- SDK 明确可恢复的初始化错误。

禁止自动重试：

- CPU 架构错误；
- ELF/ABI 错误；
- 缺少动态库；
- 文件权限错误；
- 参数格式错误；
- 当前 SDK 不支持的接口。

---

## 15. Linux SDK 运行环境

### 15.1 强制目录关系

```text
运行时根目录/
├── wemeet_electron_sdk.node
├── libwemeetsdk.so
├── libwemeet_base.so
├── saas_sdk_env.json
└── Release/
```

### 15.2 环境变量

在加载 addon 前准备：

```text
PATH=<runtime>:<runtime>/Release:<原PATH>
LD_LIBRARY_PATH=<runtime>:<runtime>/Release/lib:<原LD_LIBRARY_PATH>
QT_PLUGIN_PATH=<runtime>/Release/plugins
TZ=Asia/Shanghai
```

`LC_ALL=zh_CN.UTF-8` 仅在系统存在该 locale 时设置，否则保留系统当前 UTF-8 locale，避免启动警告。

### 15.3 RPATH

原生 addon 链接时至少设置：

```text
$ORIGIN
```

用于加载与 `.node` 同级的 `libwemeetsdk.so`。

SDK 子进程和 `Release/lib` 依赖仍需使用受控运行环境。

### 15.4 文件属性

SDK 导入和打包必须保留：

- 执行权限；
- 符号链接；
- 文件模式；
- 目录结构。

构建后必须检查 SDK helper 是否可执行。具体 helper 名称以正式包实际内容为准，不能仅按最新 FAQ 写死为 `wemeetapp`。

---

## 16. 原生模块构建

`binding.gyp` 增加 Linux ARM64 target：

- 仅允许 `OS=="linux" && target_arch=="arm64"`；
- 源码使用正式包配套 `wemeet.cpp`；
- 头文件使用同版本 `SDK/include`；
- 链接同版本 `libwemeetsdk.so`；
- 是否显式链接 `wemeet_base` 以正式包链接结果为准；
- 启用 C++ exceptions；
- 使用 `$ORIGIN` RPATH；
- 输出 `.node` 至 `output/linux-arm64/`。

构建必须在 Linux ARM64 实机或 ARM64 Linux 构建环境完成。macOS 不负责链接 Linux ARM64 `.so`。

---

## 17. SDK 导入流程

`scripts/import-sdk.js` 负责：

1. 接收 `TMSDK_PACKAGE_PATH`；
2. 验证包名和版本；
3. 防止路径穿越的安全解包；
4. 提取指定文件，避免无选择地执行包内脚本；
5. 校验关键二进制为 ELF64 AArch64；
6. 导入同版本头文件；
7. 导入配套 `wemeet.cpp`；
8. 完整复制 `Release/`；
9. 保留权限和符号链接；
10. 生成导入清单和校验结果；
11. 不执行 SDK 包内未知脚本。

禁止混用不同版本的：

- `wemeet.cpp`；
- SDK 头文件；
- `libwemeetsdk.so`；
- `libwemeet_base.so`；
- `Release/`。

---

## 18. 开发与运行方式

### 18.1 macOS 开发

macOS 只用于：

- 编写 JS、HTML、CSS；
- 单元测试；
- 状态机测试；
- 回调解析测试；
- 使用 Mock SDK 检查界面交互。

Mock 模式必须显示：

```text
Mock SDK：当前不是真实 Linux SDK 环境
```

Mock SDK 不进入正式 AppImage。

### 18.2 Linux ARM64 开发

Linux 实机用于：

- 安装依赖；
- 编译 native addon；
- 检查 ELF 依赖；
- 加载 SDK；
- 初始化登录；
- 摄像头、麦克风、会议测试；
- AppImage 打包。

---

## 19. 打包设计

### 19.1 npm scripts 规划

```text
sdk:import             导入并校验正式 SDK 包
sdk:verify             检查 SDK 源文件和运行时
build:native:linux-arm64
start                  Linux 实机启动
start:mock             macOS/非 Linux UI 开发
pack:linux:arm64       生成 unpacked 目录
dist:linux:arm64       生成 AppImage
verify:package         检查 AppImage/unpacked 内容
```

### 19.2 electron-builder 规划

```text
linux.target = AppImage
linux.arch = arm64
artifactName = ${productName}-${version}-${arch}.${ext}
```

SDK 运行时通过 `extraResources` 整体复制：

```text
output/linux-arm64/
→ resources/tmsdk/linux-arm64/
```

应用 JS 可以使用 ASAR，但以下资源禁止进入 ASAR：

- `.node`；
- `.so`；
- `Release/`；
- SDK 脚本；
- SDK helper；
- `saas_sdk_env.json`。

### 19.3 协议注册

继续使用：

```text
wemeetsdk://
```

AppImage/Desktop 集成需检查：

- `.desktop` 文件；
- `MimeType=x-scheme-handler/wemeetsdk`；
- 启动参数 `%U`；
- 单实例 URL 转发；
- 冷启动和已运行状态。

Scheme 不作为首个 POC 阻断项，在会议闭环完成后实现。

---

## 20. 正式包 README/打包示例存在的缺口

正式包 README 和 Demo 可以作为基础，但不能原样搬用。已识别的缺口如下。

### 20.1 环境设置顺序

正式包示例 `main.js` 先 `require()` Linux addon，后设置 Linux 环境变量。新项目必须调整为：

```text
准备运行环境
→ 加载 addon
→ 初始化 SDK
```

### 20.2 Wayland 初始化竞态

正式包示例异步加载 Wayland 环境脚本，但没有严格等待环境准备完成再初始化 SDK。新项目必须等待环境准备 Promise 完成。

### 20.3 Electron 版本过旧

正式包 Demo 使用 Electron `17.4.11`。新项目首选 Electron `33.4.11` 并重新编译 addon，Electron 17 只作为兼容性对照。

### 20.4 `saas_sdk_env.json` 打包遗漏风险

正式包复制脚本会把 `saas_sdk_env.json` 放进 `output/linux`，但包内 electron-builder Linux `extraResources` 示例没有明确复制该文件。新项目将整个运行时目录整体复制，避免遗漏。

### 20.5 权限和符号链接缺少自动验收

README 说明需要保留权限，但示例打包流程没有完整的打包后自动检查。新项目增加 `verify:package`。

### 20.6 缺少 ARM64 硬校验

公开脚本没有统一检查 `process.arch`、ELF `e_machine` 和 SDK 包架构。新项目在导入、构建、启动三个阶段均校验 ARM64。

### 20.7 缺少能力矩阵

官方 Demo 通过硬编码 `apiFilterLinux` 过滤部分调用，但 UI 和 addon 实际导出仍可能漂移。新项目统一由 `sdk-capabilities.js` 管理。

### 20.8 缺少异步退出协调

官方 Demo 存在延时退出或直接 `ForceQuit` 的处理。新项目以 `OnSDKUninitializeResult` 为主，超时才兜底。

### 20.9 缺少安全边界

官方旧 Demo 未按现代 Electron 安全基线设计。新项目启用上下文隔离、关闭 Node 集成、限制 IPC，并确保 Token 不进入 Renderer。

### 20.10 缺少系统化测试和诊断

新项目增加：

- SDK 文件诊断；
- ABI/架构诊断；
- 状态机测试；
- 回调解析测试；
- AppImage 内容检查；
- X11 实机验收清单。

### 20.11 AppImage 运行依赖

Ubuntu 部分环境可能需要 FUSE 支持。README 需要同时提供：

- 正常 AppImage 运行方式；
- 缺少 FUSE 时的明确提示；
- unpacked 目录排障方式。

不通过默认关闭 sandbox 或全局修改系统安全配置规避问题。

---

## 21. 测试计划

### 21.1 单元测试

不依赖 Linux SDK 的测试：

- SDK 状态转换；
- 重复初始化并发锁；
- 重复登录并发锁；
- 回调 JSON 解析；
- 错误码映射；
- 能力矩阵；
- IPC 参数校验；
- 日志脱敏；
- 退出超时逻辑。

### 21.2 Linux ARM64 POC

第一阶段只验证：

- `.node` 针对 Electron 33 编译成功；
- addon 加载成功；
- `GetSDKVersion()`；
- `AddJsCallback()`；
- `InitWemeetSDK()`；
- `OnSDKInitializeResult`；
- `UninitWemeetSDK()`；
- `OnSDKUninitializeResult`。

未通过 POC 前不批量开发 UI 功能。

### 21.3 X11 完整验收

- [ ] AppImage 启动成功；
- [ ] SDK 文件检查通过；
- [ ] SDK 初始化成功；
- [ ] 业务账号登录成功；
- [ ] SDK 登录成功；
- [ ] 普通会议入会成功；
- [ ] 有密码会议入会成功；
- [ ] 快速会议成功；
- [ ] 摄像头正常；
- [ ] 麦克风正常；
- [ ] 会前页面正常；
- [ ] 会议设置正常；
- [ ] 历史会议正常；
- [ ] 字幕和布局支持项正常；
- [ ] 会中窗口操作正常；
- [ ] 离会成功；
- [ ] 登出成功；
- [ ] 反初始化完成后退出；
- [ ] 第二次启动无残留状态；
- [ ] 网络中断后错误可理解；
- [ ] 日志中无完整 Token/SSO URL；
- [ ] AppImage 内 SDK helper 权限正确。

### 21.4 Wayland 冒烟验收

- [ ] 应用启动；
- [ ] SDK 初始化；
- [ ] SDK 登录；
- [ ] 基本入会；
- [ ] 摄像头；
- [ ] 麦克风；
- [ ] 退出；
- [ ] 失败时给出切换 X11 的明确提示。

---

## 22. 开发阶段

### 阶段 1：独立工程骨架

交付：

- Electron 主进程；
- preload；
- 基础 UI；
- IPC 安全边界；
- SDK 状态机；
- Mock SDK；
- 环境诊断页面。

### 阶段 2：SDK 导入和原生 POC

交付：

- SDK 安全导入脚本；
- ARM64/版本/权限校验；
- Linux `binding.gyp`；
- Electron 33 addon；
- 加载、初始化、回调、反初始化闭环。

### 阶段 3：鉴权闭环

交付：

- 业务账号登录；
- Token 刷新；
- SDK Token；
- ID Token/SSO URL；
- SDK 登录和登出；
- 安全 Token 存储。

### 阶段 4：会议能力

交付：

- Linux 支持的会前和会中接口；
- 参数表单；
- 回调日志；
- 错误处理；
- 不支持能力自动隐藏。

### 阶段 5：打包与实机验收

交付：

- ARM64 AppImage；
- unpacked 排障包；
- 打包后资源检查；
- Ubuntu 22.04 X11 完整测试；
- Wayland 冒烟测试；
- 用户运行 README。

---

## 23. 实现开始前的前置条件

- [x] Linux ARM64 正式 SDK 包已存在；
- [x] SDK 版本确定为 `3.26.100.14`；
- [x] 功能范围以 Linux SDK 能力为准；
- [x] 缺失功能不开发、不展示；
- [x] 项目路径确定为 `<项目根目录>`；
- [x] 鉴权沿用 macOS/Windows 的后端流程；
- [x] 首期交付格式确定为 ARM64 AppImage；
- [x] 首期推荐环境确定为 Ubuntu 22.04 ARM64 + X11；
- [ ] 准备 Linux ARM64 实机；
- [ ] 确认实机的 Ubuntu 版本和桌面会话；
- [ ] 确认现有后端测试地址和可用测试账号；
- [ ] 确认摄像头、麦克风可由目标系统识别。

未完成的四项不会阻止 macOS 上建立工程骨架，但会阻止真实 SDK 编译和最终验收。

---

## 24. 完成标准

项目满足以下条件才视为首期完成：

1. 项目完全独立于现有 macOS/Windows 工程运行；
2. SDK 文件全部来自同一个 `3.26.100.14` ARM64 正式包；
3. Linux ARM64 实机可编译或加载匹配 Electron 的 addon；
4. 初始化、登录、入会、离会、登出、反初始化闭环成功；
5. 摄像头和麦克风可用；
6. 不支持的接口不出现在 UI；
7. X11 完整测试通过；
8. Wayland 至少完成冒烟测试或给出明确降级提示；
9. AppImage 可在干净的 Ubuntu 22.04 ARM64 环境启动；
10. 打包后 SDK 目录、权限和符号链接完整；
11. 日志不包含 SDK Secret、完整 Token 或完整 SSO URL；
12. README 包含安装、运行、鉴权、测试、排障和已知限制。
