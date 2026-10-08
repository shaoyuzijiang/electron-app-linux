# 腾讯会议 SDK Demo（Linux ARM64 / 银河麒麟）

基于 Electron 33.4.11 + 腾讯会议 Linux SDK 3.26 的桌面会议应用，运行于银河麒麟 V10 SP1（ARM64）。
与 Mac/Windows 版本共享同一套渲染层、能力契约与后端接口，按平台能力自动降级 UI。

## 功能特性（Linux 版）

### 会议域（SDK 3.26 全量支持）

- 加入会议（默认开启摄像头，可显式关闭）、快速会议、预定会议、离开会议
- 会议列表：按日期分组、分页、进行中/周期标签、一键入会、会议号复制
- 预定会议成功后自动创建携带会议信息的日程（三端一致）
- 入会链接解析（`ParseMeetingInfoUrl`，自定义入会页面用）
- SDK 原生设置页、历史会议、会议详情、上传日志
- `wemeetsdk://` 协议唤起入会（DEB 安装时自动注册）

### 业务域（纯后端通道，与 Mac/Windows 同源）

- IM 即时通讯、日程（日/周/月三视图）、通讯录（部门树 + 搜索 + 本地缓存）
- 登录记住密码（`safeStorage` 加密存储；桌面无密钥环时自动降级为不保存，绝不落明文）
- Token 自动刷新、修改密码、代理设置

### 跨平台能力契约

共享 UI 通过 `getSdkCapabilities()` 读取 21 项平台能力决定入口显隐，
代码中不出现 `process.platform === 'linux'` 判断。
Linux 当前关闭的能力（SDK 3.26 源码级裁剪，真机已证实）：
共享屏幕、录音笔、录制查看、Rooms 控制器、直播、会中应用、字幕、AI 小助手、企业 SSO、内嵌 WebView。

## 环境要求

- 银河麒麟 V10 SP1，aarch64，glibc 2.31（构建机必须与目标基线一致）
- Node.js ≥22.12 <25、npm ≥10、Python 3、GCC（支持 `-std=gnu++2a`）、unzip、file、readelf
- 桌面会话运行（X11/XWayland，配套 `/opt/x11-wayland` 厂商补丁）

## 快速开始（麒麟离线环境）

```bash
# 1. 解压离线传输包（由开发机 npm run package:transfer:linux 生成，约 401MB）
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

## 可用命令

| 命令 | 说明 |
|------|------|
| `npm run setup:kylin` | 离线环境一键构建（含环境体检与产物检测） |
| `npm run check` | 统一检测入口（环境/构建产物/DEB 结构/图形要点），`--verbose` 看细节 |
| `npm run demo:deb` | 构建 DEB 并校验 |
| `npm run start:linux` | 图形环境就绪启动（自动 source 厂商补丁） |
| `npm run package:transfer:linux` | 生成麒麟离线传输包 |
| `npm run verify` | 源码门禁全量回归（能力契约/adapter/图形/功能对齐） |

## 自动化打包（CI 出 DEB）

推送代码到 GitHub 后自动构建 `.deb` 安装包，无需麒麟参与，详见
[`docs/AUTOPACK_PLAN.md`](./docs/AUTOPACK_PLAN.md)（开通步骤与版本管理约定）。

预编译原生模块位于 `packaging/prebuilt/wemeet_electron_sdk.arm64.node`，
仅在 Linux SDK / Electron 版本升级或修改 `native/linux` C++ 封装时需要回到麒麟重新编译。

## 项目结构（关键目录）

```
├── main.js                      # 统一入口：按平台分派主进程
├── main-darwin-win32.js         # Mac/Windows 主进程（3.43 SDK）
├── ipc-handlers.js              # Mac/Windows IPC 注册
├── common/contracts/            # 跨平台能力契约（21 项）
├── platform/
│   ├── linux-arm64/             # Linux 主进程 / SDK 3.26 adapter / 安全 IPC / 后端通道
│   └── darwin-win32/            # 桌面端能力声明
├── bootstrap/preload.js         # 共享渲染层安全桥（132 通道）
├── renderer/                    # 三端共享 UI（登录/主页/IM/日程/通讯录）
├── backend_api/                 # 后端 API 层（三端同源）
├── native/linux/                # SDK 3.26 C++ N-API 封装（麒麟编译）
├── packaging/                   # DEB 资源 + 预编译 addon + 图形环境脚本
├── scripts/                     # 构建/检测/打包脚本（check.sh 为统一检测入口）
└── docs/
    ├── AUTOPACK_PLAN.md         # 自动化打包方案管理
    └── LINUX_TEST_PLAN.md       # 麒麟真机测试计划
```

## 已知限制

- 共享屏幕、录音笔、录制查看、直播、会中应用等依赖 SDK 3.26 未暴露的接口，当前不可用
- 会议视频由 SDK 独立进程渲染（麒麟上 Electron 走软件渲染不影响视频质量）
- Linux 版 Token 仅驻留内存，退出即清除（与桌面安全策略对齐）
