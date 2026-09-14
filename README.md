# 腾讯会议 SDK Linux ARM64 Electron Demo

当前完成**阶段 1 工程骨架**和**阶段 2 SDK 导入与 Linux ARM64 原生接入准备**。项目使用 Electron `33.4.11` 与原生 HTML/CSS/JavaScript。真实 SDK 仅支持 Linux ARM64；本阶段未在 macOS 加载 Linux ELF、未完成真实初始化验收，也未进入阶段 3 鉴权开发。

## 已完成

- 安全 Electron 基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、精确 preload 白名单、精确本地入口 IPC 来源校验。
- SDK 生命周期状态机、Linux `3.26.100.14` 静态能力矩阵、回调 JSON 解析与脱敏。
- 开发专用 Mock SDK 和基础控制台 UI；正式打包默认排除 Mock。
- SDK 安全导入：白名单提取、压缩包路径与符号链接检查、ARM64 ELF 校验、SHA-256 manifest、运行资源权限与链接保留。
- Linux ARM64 原生构建配置：同版本 `native/wemeet.cpp`、SDK 头文件、`libwemeetsdk.so`、`$ORIGIN` RPATH 和 C++ exceptions。
- 真实 runtime、Loader 和 POC 准备：运行时路径选择、环境变量、X11/Wayland 识别、`GetSDKVersion()`、运行时导出接口交集。
- 统一会议客户端风格 UI：浅色导航、登录卡、状态区、内容卡、内部滚动的回调日志与环境诊断，以及开发专用 Mock 提示。
- GitHub 上传安全准备：SDK/原生产物/归档/.env/本机路径预检，以及麒麟 ARM64 手工操作文档。

官方桥接源码会导入到 `native/wemeet.cpp`。导入时仅移除其中对 `InitWemeetSDK` 第二个参数（SDK Token）的日志写入；上游 SHA-256、最终 SHA-256 和补丁说明记录在 `sdk-manifest.json`，不会记录任何 Token。

## SDK 导入与校验

仅通过命令行参数或环境变量提供 SDK 包路径，脚本不会执行包内 `.sh`、二进制或安装脚本：

```bash
export TMSDK_PACKAGE_PATH="/path/to/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz"
npm run sdk:import
npm run sdk:verify
```

导入位置：

```text
sdk/linux-arm64/3.26.100.14/
├── include/
├── libwemeetsdk.so
├── libwemeet_base.so
├── saas_sdk_env.json
├── Release/
├── prebuilt/wemeet_electron_sdk.node
└── sdk-manifest.json

native/wemeet.cpp
```

`prebuilt/wemeet_electron_sdk.node` 仅保存为官方 Electron 17 基线，不能作为正式 Electron 33 产物。

## macOS 可完成的工作

macOS 可执行 SDK 导入、静态 ELF/ARM64 校验、单元测试、Lint 和 Mock UI 验证：

```bash
npm install
npm run sdk:import
npm run sdk:verify
npm run test
npm run lint
npm run start:mock
```

真实模式在 macOS 会在加载 addon 前明确拒绝，不会尝试加载 Linux ELF。不要在 macOS 构建或链接 Linux ARM64 `.so`。

## 界面说明

应用默认窗口为 `1000 × 700`，最小窗口为 `800 × 600`。界面采用与现有桌面 Demo 对齐的浅色会议客户端层级：左侧导航、顶部状态标签、登录卡、操作卡、状态/错误提示、关于弹窗和可内部滚动的日志/诊断列表。

登录页仅用于 Mock SDK 显示名称；没有真实账号、密码、Token 或网络鉴权。Mock 模式始终显示：`Mock SDK：当前不是真实 Linux SDK 环境`。Linux SDK 不支持的能力不会显示为按钮或灰色占位项。

## Linux ARM64 构建与运行时

在 Ubuntu 22.04 ARM64（优先 X11）上，先完成导入和源 SDK 校验，再构建：

```bash
npm install
npm run sdk:verify
npm run build:native:linux-arm64
npm run verify:runtime
```

构建脚本使用 Electron `33.4.11` headers，生成的 addon 经暂存后必须与 SDK 资源保持以下同级关系：

```text
output/linux-arm64/
├── wemeet_electron_sdk.node
├── libwemeetsdk.so
├── libwemeet_base.so
├── saas_sdk_env.json
└── Release/
```

`npm run sdk:stage` 默认只接受已经重新编译的 `output/linux-arm64/wemeet_electron_sdk.node`。仅在 ABI 兼容性排障时可显式执行 `npm run sdk:stage -- --use-prebuilt`；不得将其用于正式产物。

运行时会在加载 addon 前设置仅对本进程有效的 `PATH`、`LD_LIBRARY_PATH`、`QT_PLUGIN_PATH`、`TZ`，并且只有检测到系统存在 `zh_CN.UTF-8` 时才设置 `LC_ALL`。Wayland 仅采用 SDK `Release/x11-wayland/x11-ext.sh` 的受控、等价环境规则，不修改系统全局环境、不写入 `/opt`，也不使用 `--no-sandbox`。

## 统一业务鉴权设计（尚未实现）

正式 Linux 客户端将与现有 macOS/Windows 客户端保持一致：用户只输入业务账号和密码。主进程在运行时依次调用 `/api/auth/public-key`、`/api/auth/login`、`/api/auth/profile`、`/api/auth/sdk-token` 和 `/api/auth/id-token`，再由回调驱动 SDK 初始化与登录；退出时调用 `/api/auth/logout`。

用户不会手工输入 SDK ID、SDK Token、ID Token 或 SSO URL。SDK Secret、私钥、业务 Token、SDK Token、ID Token 和完整 SSO URL 均不进入 Renderer、日志、诊断信息或 Git 仓库。当前仅在 `src/main/auth/auth-contract.js` 固化了接口和主进程边界；未实现真实 HTTP 请求、账号登录或凭证存储。

## Linux ARM64 POC

POC 仅验证 runtime、addon、`GetSDKVersion()`、`AddJsCallback()`、初始化回调和反初始化回调；不登录、不入会。

无凭证时，POC 安全停在 addon 加载和版本查询：

```bash
npm run poc:linux-arm64
```

具备由服务端提供的临时 SDK ID/Token 后，凭证只能通过当前 shell 环境传入，不能写入代码、配置或日志：

```bash
TMSDK_ID='...' TMSDK_TOKEN='...' npm run poc:linux-arm64
```

预期依次看到 addon 版本、导出数量、初始化回调成功、反初始化回调成功。未通过前不得继续开发真实登录和会议功能。

## 常见错误

- `不是 ELF64` 或 `e_machine` 非 `183`：导入了错误架构或错误文件，重新检查 SDK 包来源。
- `加载 Linux ARM64 SDK addon 失败`：检查是否在 Linux ARM64、Electron 版本是否为 `33.4.11`、`wemeet_electron_sdk.node` 是否重新编译、`.so` 是否与 addon 同级。
- `SDK helper 缺少执行权限` 或 `符号链接断裂`：重新导入并检查打包/复制流程是否保留模式和链接。
- `真实 Linux SDK 仅支持 linux/arm64`：当前是 macOS、Windows、x64 或其他架构，只能进行静态检查和 Mock 验证。

## GitHub 与麒麟 ARM64 手工操作

GitHub 仓库应保持私有，建议名称为 `electron-app-linux`。提交前执行：

```bash
npm run lint
npm run test
npm run github:preflight
npm run start:mock
git status
git ls-files
```

`github:preflight` 只报告疑似凭证的文件路径和问题类型，不输出任何值；它会阻止提交 SDK 提取产物、原生二进制、归档、`.env`、超过 50MB 文件和本机私有路径。

麒麟 ARM64 电脑的无 AI 手工操作步骤见 [`docs/KYLIN_ARM64_MANUAL.md`](docs/KYLIN_ARM64_MANUAL.md)。该文档覆盖私有仓库 clone、依赖安装、SDK 单独下载与安全导入、原生构建和 POC。

## 未完成范围

- 未在 Linux ARM64 实机验证 addon 编译、加载、初始化或反初始化。
- 未实现真实鉴权、后端、Secret、SDK Token 获取、ID Token 或 SSO URL。
- 未实现真实登录、入会、设备、会中控制或 AppImage 最终验收。
- Linux SDK 明确不支持的能力不会注册 IPC 或展示在主操作面板。

下一阶段仅应在 Linux ARM64 POC 成功后，按设计进入鉴权闭环。
