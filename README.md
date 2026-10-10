# 腾讯会议 SDK Demo（Linux ARM64 / 银河麒麟）

基于 Electron 33.4.11 + 腾讯会议 Linux SDK 3.26 的桌面会议应用，运行于银河麒麟 V10 SP1（ARM64）。
与 Mac/Windows 版本共享同一套渲染层、能力契约与后端接口，按平台能力自动降级 UI。

---

## 一、安装与使用（普通用户看这里）

### 1. 获取安装包

**方式 A：Release 页下载（推荐）**

打开 [Releases · 最新安装包](https://github.com/shaoyuzijiang/electron-app-linux/releases) → 下载最新构建的
`tencent-meeting-sdk-demo-<版本>-<日期>-arm64.deb`（命名节奏与 Windows/macOS 下载页一致：名称-版本-日期-架构）。

> 也可以用命令行直接拉最新版：
> `gh release download latest -R shaoyuzijiang/electron-app-linux`

### 2. 安装

把 `.deb` 传到麒麟机器后（U 盘 / 内网传输均可），在终端执行：

```bash
# 进入 deb 所在目录
cd ~/Downloads

# 安装（文件名以实际下载的日期版本为准）
sudo dpkg -i tencent-meeting-sdk-demo-*.deb
```

安装脚本会自动完成：

- 应用文件落位 `/opt/tencent-meeting-sdk-linux-demo/`
- 应用菜单创建"腾讯会议 SDK Demo"图标
- 注册 `wemeetsdk://` 协议（支持从浏览器/聊天中的会议链接唤起入会）

### 3. 启动

```bash
# 方式一：应用菜单 → "腾讯会议 SDK Demo"
# 方式二：命令行
tencent-meeting-sdk-linux-demo
```

首次启动进入登录页，输入账号密码即可（可勾选"记住密码"，密码经系统安全存储加密保存）。

### 4. 升级与卸载

```bash
# 升级：下载新版 deb 后直接覆盖安装，用户数据不受影响
sudo dpkg -i tencent-meeting-sdk-demo-*.deb

# 卸载应用（保留个人数据）
sudo dpkg -r tencent-meeting-sdk-linux-demo

# 彻底清除（连同本地 Token、缓存、记住的密码一起删除）
sudo dpkg -P tencent-meeting-sdk-linux-demo
rm -rf ~/.config/tencent-meeting-sdk-demo
```

### 5. 用户数据与日志位置

| 内容 | 路径 |
|------|------|
| 应用程序 | `/opt/tencent-meeting-sdk-linux-demo/` |
| 本地数据（Token/缓存/记住的密码） | `~/.config/tencent-meeting-sdk-demo/` |
| 运行日志 | `~/.config/tencent-meeting-sdk-demo/logs/` |

遇到问题时，把 `logs/` 下最新日志发给维护者即可定位。

### 6. 功能入口速查

| 操作 | 入口 |
|------|------|
| 加入会议 | 首页"加入会议"输入会议号；或点击聊天中的 `wemeetsdk://` 链接 |
| 快速会议 | 首页"快速会议"，一键开始 |
| 预定会议 | 首页"预定会议"，保存后自动同步到日程（可从日历一键入会） |
| IM / 日程 / 通讯录 | 左侧边栏页签 |
| 修改密码 / 上传日志 / 退出 | 右上角头像菜单 |

---

## 二、功能特性

### 会议功能

- 加入会议（默认开启摄像头，可显式关闭）、快速会议、预定会议、离开会议
- 会议列表：按日期分组、分页加载、进行中/周期标签、一键入会、会议号复制
- 预定会议成功后自动同步为日程（内嵌会议号/入会链接，自动去重，与 Mac 端一致）
- SDK 原生设置页、历史会议、会议详情、上传日志
- 会中窗口操作（置顶/最小化/最大化）、入会链接解析（`ParseMeetingInfoUrl`）
- 响铃邀请、会中会议信息回调

### IM / 日程 / 通讯录（与 Mac/Windows 同源）

- **IM**：WebSocket 实时消息 + HTTP 备用通道、单聊/群聊、图片/文件消息、未读管理、IndexedDB 本地缓存
- **日程**：紧凑月历 + 日/周/月三视图 + 详情面板；保存日程时勾选"创建腾讯会议"可自动创建会议并回填
- **通讯录**：部门树浏览、分页加载、关键词搜索、本地缓存秒开

### 用户认证

- 账号密码登录（RSA + AES 混合加密传输）
- 记住密码（`safeStorage` 加密；桌面无密钥环时自动降级为不保存，绝不落明文）
- Token 自动刷新、修改密码、服务端地址切换

### 平台架构

- 统一入口按平台分派：Linux ARM64 → SDK 3.26 adapter；Mac/Windows → 既有主进程
- 21 项跨平台能力契约（`getSdkCapabilities`），共享 UI 按能力自动降级，代码中无平台 if 判断
- 渲染层与原生 SDK 完全隔离（adapter 内部持有 addon，preload 只暴露安全通道）
- Linux ARM64 Token 仅驻留内存；SDK 并发保护、会话代次隔离、30 秒回调超时
- 全进程日志统一落盘，自动清理 7 天过期日志
- 麒麟图形环境自动适配（X11-Wayland 厂商补丁、LD_PRELOAD 清理、SDK 私有库前插）

---

## 三、已知限制

以下能力依赖 SDK 3.26 未暴露的接口（源码级裁剪，真机已证实），当前不可用：

> 共享屏幕、录音笔、录制查看、Rooms 控制器、直播、会中应用、字幕、AI 小助手、企业 SSO、内嵌 WebView

拿到暴露对应接口的新版 Linux SDK 后，升级 `vendor/` 供应物并重编 addon 即可解锁（见踩坑文档"addon 重编"一节）。

其他说明：

- 会议视频由 SDK 独立进程渲染，Electron 走软件渲染不影响视频质量
- Linux 版 Token 仅驻留内存，退出即清除
- **遇到任何构建/运行/推送问题，先查 [`docs/PITFALLS.md`](./docs/PITFALLS.md)（24 个已踩过的坑：症状 → 原因 → 解决）**

---

## 四、开发者指南

### 环境要求（仅构建需要，日常使用不需要）

- 银河麒麟 V10 SP1，aarch64，glibc 2.31（构建机必须与目标基线一致）
- Node.js ≥22.12 <25、npm ≥10、Python 3、GCC（支持 `-std=gnu++2a`）、unzip、file、readelf

### 从源码构建（麒麟离线）

```bash
# 1. 解压离线传输包（开发机 npm run package:transfer:linux 生成）
mkdir -p ~/wemeet-build
tar -xzf wemeet-demo-transfer-*.tar.gz -C ~/wemeet-build --strip-components=1
cd ~/wemeet-build

# 2. 一键构建（环境体检 → 离线装依赖 → Electron → SDK → 编译 addon → 检测）
npm run setup:kylin

# 3. 构建 DEB 并自动校验
npm run demo:deb
sudo dpkg -i dist-demo/*.deb
```

### 命令速查

| 命令 | 说明 |
|------|------|
| `npm run setup:kylin` | 离线环境一键构建（含环境体检与产物检测） |
| `npm run check` | 统一检测入口（环境/构建产物/DEB 结构/图形要点），`--verbose` 看细节 |
| `npm run demo:deb` | 构建 DEB 并自动校验 |
| `npm run start:linux` | 图形环境就绪启动（自动 source 厂商补丁） |
| `npm run package:transfer:linux` | 生成麒麟离线传输包 |
| `npm run verify` | 源码门禁全量回归（能力契约/adapter/图形/功能对齐） |

### 自动化打包（CI）

推送代码到 main 分支后自动构建 DEB 并发布到 Release `latest`，无需麒麟参与。
方案、开通步骤与 addon 重编时机见 [`docs/AUTOPACK_PLAN.md`](./docs/AUTOPACK_PLAN.md)。

### 项目结构（关键目录）

```
├── main.js                      # 统一入口：按平台分派主进程
├── main-darwin-win32.js         # Mac/Windows 主进程（3.43 SDK）
├── ipc-handlers.js              # Mac/Windows IPC 注册
├── binding.gyp                  # 原生 addon 编译配置（linux-arm64 / mac / win）
├── common/contracts/            # 跨平台能力契约（21 项）
├── platform/
│   ├── linux-arm64/             # Linux 主进程 / SDK 3.26 adapter / 安全 IPC / 后端通道
│   └── darwin-win32/            # 桌面端能力声明
├── bootstrap/preload.js         # 共享渲染层安全桥（132 通道）
├── renderer/                    # 三端共享 UI（登录/主页/IM/日程/通讯录）
├── backend_api/                 # 后端 API 层（三端同源）
├── native/linux/                # Linux SDK 3.26 C++ N-API 封装（麒麟编译）
├── packaging/                   # DEB 资源 + 预编译 addon + 图形环境脚本
├── scripts/                     # 构建/检测/打包脚本（check.sh 为统一检测入口）
├── utils/                       # Token 存储 / 日志 / 账号存储 / webview 管理
└── docs/
    ├── AUTOPACK_PLAN.md         # 自动化打包方案管理
    ├── LINUX_TEST_PLAN.md       # 麒麟真机测试计划
    └── PITFALLS.md              # 踩坑记录（问题 → 原因 → 解决）
```
