# 腾讯会议 SDK Demo

基于 Electron + 腾讯会议 SDK 的桌面会议应用示例，支持加入会议、快速会议、预定会议、共享屏幕等功能。

## 功能特性

- SSO 登录 / 自动登录
- 加入会议、快速会议、预定会议、共享屏幕
- 会议列表展示
- macOS Apple Silicon (arm64) & Intel (x64) 双架构支持

## 环境要求

- Node.js >= 18
- Xcode Command Line Tools（macOS 编译原生模块）
- Python 3（node-gyp 依赖）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

`postinstall` 会自动编译 arm64 架构的原生模块。

### 2. 启动开发

```bash
npm run dev
```

启动前会自动将 SDK Framework 拷贝到 Electron.app 中。

## 项目结构

```
├── main.js                # Electron 主进程
├── preload.js             # 预加载脚本（IPC 桥接）
├── api.js                 # 后端 API 请求（RSA+AES 加密）
├── token-store.js         # Token 持久化存储
├── start.js               # 启动前脚本（拷贝 SDK Framework）
├── binding.gyp            # node-gyp 原生模块编译配置
├── entitlements.mac.plist # macOS 权限声明
├── renderer/
│   ├── login.html         # 登录页
│   └── index.html         # 会议主页
├── wemeet_sdk/
│   └── mac/Frameworks/    # SDK 动态库（arm64 / x64）
├── output/
│   └── mac/               # 编译产物（.node 原生模块）
└── include/               # C++ 头文件
```

## 构建原生模块

```bash
# 仅编译当前架构（arm64）
npm run build:native:arm64

# 编译 Intel 架构（需要 Rosetta 2）
npm run build:native:x64

# 同时编译双架构
npm run build:native
```

> Intel 架构编译需要 Rosetta 2，如未安装请执行：
> ```bash
> softwareupdate --install-rosetta
> ```

## 打包安装包

```bash
# 打包所有架构（arm64 + x64 + universal）
npm run dist

# 按架构打包
npm run dist:arm64       # Apple Silicon 专用
npm run dist:x64         # Intel 专用
npm run dist:universal   # 通用二进制（同时支持两种架构）
```

打包产物输出到 `dist/` 目录，macOS 生成 `.dmg` 安装包。

### 打包完整流程

```bash
# 1. 编译双架构原生模块
npm run build:native

# 2. 打包安装包
npm run dist
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发模式 |
| `npm run build:native` | 编译双架构原生模块 |
| `npm run build:native:arm64` | 仅编译 arm64 原生模块 |
| `npm run build:native:x64` | 仅编译 x64 原生模块 |
| `npm run dist` | 打包全部架构安装包 |
| `npm run dist:arm64` | 打包 arm64 安装包 |
| `npm run dist:x64` | 打包 x64 安装包 |
| `npm run dist:universal` | 打包通用安装包 |
| `npm run pack` | 仅打包目录（不生成安装包） |

## 注意事项

- 未签名/未公证的 `.dmg` 在其他 Mac 上打开时会被 Gatekeeper 拦截，需右键 → 打开，或执行 `xattr -cr <app路径>` 去除隔离属性
- SDK Framework 在开发模式下通过 `start.js` 自动拷贝到 Electron.app 中，打包时通过 `extraResources` 自动处理

### Universal 构建说明

Universal 构建会将 arm64 和 x64 两个架构的 app 合并为一个通用二进制，需注意以下几点：

1. **原生模块需双架构编译**：运行 `npm run build:native` 生成 arm64 和 x64 两个 `.node` 文件，`dist:universal` 会自动通过 `lipo -create` 将它们合并为通用二进制
2. **SDK Framework 符号链接**：`wemeet_sdk/mac/Frameworks/x64/TMSDK.framework` 必须是**相对符号链接**（`../arm64/TMSDK.framework`），不能是绝对路径符号链接，否则 `@electron/universal` 合并时因路径不一致会报 mach-o mismatch 错误
3. **架构特定 .node 文件已排除**：`package.json` 的 `files` 配置中排除了 `wemeet_electron_sdk.arm64.node` 和 `wemeet_electron_sdk.x64.node`，只保留合并后的通用 `wemeet_electron_sdk.node`

### 更新 SDK 包

当需要替换新版腾讯会议 SDK 时，请按以下步骤操作：

1. **替换 SDK 文件**：将新 SDK 的 `wemeet_sdk/` 目录整体替换到项目根目录
2. **检查符号链接**：确保 `wemeet_sdk/mac/Frameworks/x64/TMSDK.framework` 是**相对符号链接**，而非绝对路径符号链接。替换后执行以下命令检查和修复：
   ```bash
   # 检查符号链接类型
   readlink wemeet_sdk/mac/Frameworks/x64/TMSDK.framework
   
   # 如果输出是绝对路径（以 / 开头），需修复为相对路径：
   cd wemeet_sdk/mac/Frameworks/x64
   rm TMSDK.framework
   ln -s ../arm64/TMSDK.framework TMSDK.framework
   cd -
   ```
3. **重新编译原生模块**：SDK 更新后通常需要重新编译 `.node` 原生模块：
   ```bash
   npm run build:native
   ```
4. **验证**：运行 `npm run dev` 确认 SDK 加载正常后再打包
