# 腾讯会议 SDK Demo（Linux ARM64 / 银河麒麟）

基于 Electron 33.4.11 + 腾讯会议 Linux SDK 3.26 的桌面会议应用示例，运行于银河麒麟 V10 SP1（ARM64）。
与 Mac/Windows 版本共享同一套渲染层、能力契约与后端接口，按平台能力自动降级 UI。

## 功能特性

### 用户认证

- 账号密码登录（RSA + AES 混合加密传输）
- 记住密码（`safeStorage` 加密存储；桌面无密钥环时自动降级为不保存，绝不落明文）
- Token 自动刷新（AccessToken 过期后用 RefreshToken 续期）
- 修改密码（密码强度校验）、服务端地址切换

### 会议功能

- 加入会议（默认开启摄像头，可显式关闭）、快速会议、预定会议、离开会议
- 会议列表：按日期分组、分页加载、进行中/周期标签、一键入会、会议号复制
- 预定会议成功后自动同步为日程（含会议号/入会链接，带去重，三端一致）
- 预定会议成功后自动同步为日程（内嵌会议号/入会链接，支持从日历直接入会，自动去重）
- SDK 原生设置页、历史会议、会议详情、上传日志
- 会中窗口操作（置顶/最小化/最大化）、入会链接解析（`ParseMeetingInfoUrl`）
- 响铃邀请、会中会议信息回调

### URL Scheme 唤起

- 注册 `wemeetsdk://` 协议，会议链接唤起应用自动入会（DEB 安装时由 postinst 注册）
- 冷启动暂存 URL，SDK 登录成功后自动处理
- 已登录时直接调用 SDK `HandleSchema` 入会，窗口自动前置

### IM / 日程 / 通讯录（纯后端通道，与 Mac/Windows 同源）

- **IM**：WebSocket 实时消息 + HTTP 备用通道、单聊/群聊、图片/文件消息、未读管理、IndexedDB 本地缓存
- **日程**：紧凑月历 + 日/周/月三视图 + 详情面板；勾选"创建腾讯会议"保存日程时自动创建会议并回填
- **通讯录**：部门树浏览、分页加载、关键词搜索、本地缓存秒开
- 预定会议成功自动同步日程、从日程直接入会

### 平台与架构

- 统一入口按平台分派：Linux ARM64 → SDK 3.26 adapter；Mac/Windows → 既有主进程
- 21 项跨平台能力契约（`getSdkCapabilities`），共享 UI 按能力自动降级，代码中无平台 if 判断
- 渲染层与原生 SDK 完全隔离（adapter 内部持有 addon，preload 只暴露安全通道）
- Linux ARM64 Token 仅驻留内存；SDK 并发保护、会话代次隔离、30 秒回调超时
- 全进程日志（主进程与渲染进程 console 统一落盘，自动清理 7 天过期日志）
- 麒麟图形环境自动适配（X11-Wayland 厂商补丁、LD_PRELOAD 清理、SDK 私有库前插）

## 环境要求

- 银河麒麟 V10 SP1，aarch64，glibc 2.31（构建机必须与目标基线一致）
- Node.js ≥22.12 <25、npm ≥10、Python 3、GCC（支持 `-std=gnu++2a`）、unzip、file、readelf
- 桌面会话运行（X11/XWayland，配套 `/opt/x11-wayland` 厂商补丁）

## 快速开始（麒麟离线环境）

```bash
# 1. 解压离线传输包（开发机 npm run package:transfer:linux 生成，约 401MB）
mkdir -p ~/wemeet-build
tar -xzf wemeet-demo-transfer-*.tar.gz -C ~/wemeet-build --strip-components=1
cd ~/wemeet-build

# 2. 一键构建（环境体检 → 离线装依赖 → Electron → SDK → 编译 addon → 检测）
npm run setup:kylin

# 3. 构建 DEB 安装包并自动校验
npm run demo:deb

# 4. 安装体验
sudo dpkg -i dist-demo/*.deb
# 应用菜单"腾讯会议SDK Demo"，或终端执行 tencent-meeting-sdk-linux-demo

# 卸载
sudo dpkg -r tencent-meeting-sdk-linux-demo
```

> 全程使用普通用户操作，不要 sudo 运行 npm。

## 自动化打包（推荐）

推送代码到 GitHub main 分支后自动出 DEB 并发布到 Release，无需麒麟参与：

- 构建产物固定直链（每次覆盖为最新版）：
  `https://github.com/shaoyuzijiang/electron-app-linux/releases/download/latest/wemeet-demo-linux-arm64.deb`
- 方案与开通步骤见 [`docs/AUTOPACK_PLAN.md`](./docs/AUTOPACK_PLAN.md)

预编译原生模块位于 `packaging/prebuilt/wemeet_electron_sdk.arm64.node`，
仅在 Linux SDK / Electron 版本升级或修改 `native/linux` C++ 封装时需要回到麒麟重新编译。

## 项目结构（关键目录）

```
├── main.js                      # 统一入口：按平台分派主进程
├── main-darwin-win32.js         # Mac/Windows 主进程（3.43 SDK）
├── ipc-handlers.js              # Mac/Windows IPC 注册
├── binding.gyp                  # 原生 addon 编译配置（linux-arm64 / mac / win）
├── common/contracts/            # 跨平台能力契约（21 项）
├── platform/
│   ├── linux-arm64/             # Linux 主进程 / SDK 3.26 adapter / 安全 IPC / 后端通道
│   └── darwin-win32/            # 桌面端能力声明
├── bootstrap/
│   ├── preload.js               # 共享渲染层安全桥（132 通道）
│   ├── build.js                 # Mac/Windows electron-builder 入口
│   └── after-pack.js            # Mac 打包钩子（Framework 拷贝 + 签名）
├── renderer/                    # 三端共享 UI（登录/主页/IM/日程/通讯录）
├── backend_api/                 # 后端 API 层（三端同源）
├── sdk_mgmt/                    # Mac/Windows SDK 加载与管理
├── native/linux/                # Linux SDK 3.26 C++ N-API 封装（麒麟编译）
├── packaging/                   # DEB 资源 + 预编译 addon + 图形环境脚本
├── scripts/                     # 构建/检测/打包脚本（check.sh 为统一检测入口）
├── utils/                       # Token 存储 / 日志 / 账号存储 / webview 管理
└── docs/
    ├── AUTOPACK_PLAN.md         # 自动化打包方案管理
    └── LINUX_TEST_PLAN.md       # 麒麟真机测试计划
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run setup:kylin` | 离线环境一键构建（含环境体检与产物检测） |
| `npm run check` | 统一检测入口（环境/构建产物/DEB 结构/图形要点），`--verbose` 看细节 |
| `npm run demo:deb` | 构建 DEB 并自动校验 |
| `npm run start:linux` | 图形环境就绪启动（自动 source 厂商补丁） |
| `npm run package:transfer:linux` | 生成麒麟离线传输包 |
| `npm run verify` | 源码门禁全量回归（能力契约/adapter/图形/功能对齐） |

> 排查渲染/图形问题时使用 `npm run check -- --verbose` 查看图形栈深度诊断。

## 注意事项

- 全程使用普通用户操作，不要 sudo 运行 npm，也不要使用 `--no-sandbox`
- 麒麟安全认证（kysec）可能拦截 `python3 -c`，构建脚本已内置兼容 wrapper
- 不调用 `ldd` 探测 SDK 私有库（会触发安全弹窗），依赖检查走 readelf 静态解析
- 会议视频由 SDK 独立进程渲染，Electron 禁用 GPU 走软件渲染不影响视频质量
- Linux 版 Token 仅驻留内存，退出即清除；升级 SDK/Electron 后需按
  [`docs/AUTOPACK_PLAN.md`](./docs/AUTOPACK_PLAN.md) 回麒麟重编 addon

## 已知限制

以下能力依赖 SDK 3.26 未暴露的接口（源码级裁剪，真机已证实），当前不可用：
共享屏幕、录音笔、录制查看、Rooms 控制器、直播、会中应用、字幕、AI 小助手、企业 SSO、内嵌 WebView。
拿到暴露对应接口的新版 Linux SDK 后，升级 `vendor/` 供应物并重编 addon 即可解锁。
