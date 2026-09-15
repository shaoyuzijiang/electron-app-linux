# 麒麟 ARM64 手工安装、SDK 导入与 POC 指南

本文面向没有 AI 协助的麒麟 ARM64 电脑。本文只覆盖 SDK 导入、原生构建准备和 POC；**不包含真实业务登录、会议功能或生产发布**。

## 已确认的麒麟实机基线

已报告的实机环境为：

```text
系统：Kylin Desktop V10 SP1
架构：aarch64
glibc：2.31
Git：2.25.1
桌面会话：Wayland
/home 可用空间：约 68 GB
项目目录：/home/ctf/Dev/electron-app-linux
SDK 包：/home/ctf/sdk-packages/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz
```

该环境可以先完成 SDK 导入和原生编译。当前会话为 Wayland；若 SDK 初始化或窗口功能出现问题，优先切换到 X11/Xorg 后重新验证。不要修改系统全局 Wayland/X11 配置。

## 0. 操作边界

- 使用私有 GitHub 仓库 `electron-app-linux`；不要将 SDK 压缩包、`Release/`、`.so`、`.node`、Token 或 `.env` 提交到仓库。
- SDK 正式包需要单独从授权渠道下载到麒麟电脑；不得从 GitHub 仓库下载或上传。
- 不运行 SDK 包内的任何 `.sh`、安装器或二进制。项目的 `sdk:import` 只做白名单解压和静态检查。
- SDK ID/Token 仅用于 POC 当前 shell；不要写入文件、终端历史、截图或日志。

## 1. 确认系统和架构

打开终端并执行：

```bash
uname -m
cat /etc/os-release
printf 'session=%s\n' "$XDG_SESSION_TYPE"
```

预期：`uname -m` 输出 `aarch64` 或 `arm64`。优先使用 X11 会话；Wayland 仅做后续冒烟验证。

## 2. 安装基础依赖

先确认包管理器：

```bash
command -v apt-get || command -v dnf || command -v yum
```

### Debian/Ubuntu/麒麟 apt 系列

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates curl build-essential python3 pkg-config
```

### RPM/dnf 系列

```bash
sudo dnf install -y git ca-certificates curl gcc-c++ make python3 pkgconf-pkg-config
```

安装组织批准的 Node.js 20 LTS（或兼容的 Node.js 18+）后验证：

```bash
node --version
npm --version
```

不要修改全局 Git 配置，不要使用 `sudo npm`。

## 3. Clone 私有仓库

在授权账号已配置好 GitHub 访问后执行。将占位地址替换为组织提供的私有仓库地址：

```bash
git clone <PRIVATE_GITHUB_REPOSITORY_URL> electron-app-linux
cd electron-app-linux
git status
npm ci
```

预期 `git status` 显示工作区干净。`npm ci` 不会在麒麟机以外构建原生 addon；正式构建在第 6 节执行。

## 4. 单独放置正式 SDK 包

从授权渠道下载或拷贝以下文件到本机的私有目录，例如 `~/Downloads/`：

```text
TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz
```

确认文件存在：

```bash
ls -lh ~/Downloads/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz
```

不要解压该包，也不要执行包内脚本。

## 5. 安全导入和静态校验

在仓库根目录执行：

```bash
export TMSDK_PACKAGE_PATH="$HOME/Downloads/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz"
npm run sdk:import
npm run sdk:verify
```

导入成功后，SDK 只存在本机以下位置，并被 `.gitignore` 排除：

```text
sdk/linux-arm64/3.26.100.14/
native/wemeet.cpp
```

若 `sdk:verify` 报告 ELF、AArch64、权限、符号链接或 manifest 错误，停止继续操作，重新获取同版本 ARM64 包；不要手工替换单个 `.so` 或 `Release/` 文件。

如果 GNU tar 在 `sdk:import` 中针对 `Release/plugins` 下大量文件报告“归档中找不到”，这是旧版导入器同时传入父目录和子成员导致。更新到修复提交后直接重新执行 `npm run sdk:import`；不要手工补 `iconengines`、Wayland Qt 插件或其他 `.so`，也不要修改 SDK 包。

新版导入日志会显示 tar 版本、归档成员总数、安全选中成员数、实际提取项数量和列表。归档显式包含 `SDK/include/` 和 `SDK/Release/` 两个目录成员时，实际提取项**精确为 7 个**；若归档缺少目录成员，导入器会输出 fallback 提示并使用受限成员清单兼容提取。如果检测到旧导入失败残留，导入器会提示核查而不会自动删除未知文件。

## 6. 构建 Electron 33 原生 addon 与暂存运行时

```bash
npm run build:native:linux-arm64
npm run verify:runtime
```

预期最终目录为：

```text
output/linux-arm64/
├── wemeet_electron_sdk.node
├── libwemeetsdk.so
├── libwemeet_base.so
├── saas_sdk_env.json
└── Release/
```

构建失败时先记录完整错误信息，并检查：

```bash
node --version
npm --version
uname -m
npm run sdk:verify
```

不要在构建失败后使用 `--no-sandbox`，不要写入 `/opt`，不要全局修改 `LD_LIBRARY_PATH`。

## 7. 正常客户端登录与当前阶段边界

正常 Linux 客户端完成后，用户体验将与 macOS/Windows 一致：只输入业务账号和密码。应用运行时会通过现有后端完成业务登录、获取业务会话、取得 SDK 初始化材料、初始化 SDK、取得 SDK 登录材料并等待 `OnLogin`。用户**不**手工输入 SDK ID、SDK Token、ID Token 或 SSO URL。

当前阶段尚未实现真实后端调用或正式登录页；不要尝试通过 `.env`、配置文件或命令行向普通应用注入上述材料。以下环境变量仅保留给第 8 节的原生 POC 技术验证，不能用于日常使用。

## 8. 运行 POC

先在无凭证模式验证 addon 加载和版本查询：

```bash
npm run poc:linux-arm64
```

预期：显示 addon 版本和导出接口数量，然后提示“未提供 TMSDK_ID/TMSDK_TOKEN”；这是正常停止。

只有在服务端或授权人员提供临时 POC 凭证后，才在当前终端输入：

```bash
read -r -p 'TMSDK_ID: ' TMSDK_ID
export TMSDK_ID
read -r -s -p 'TMSDK_TOKEN: ' TMSDK_TOKEN
printf '\n'
export TMSDK_TOKEN
npm run poc:linux-arm64
unset TMSDK_ID TMSDK_TOKEN
```

预期：依次出现 addon 版本、导出接口数量、初始化回调成功、反初始化回调成功。不要复制 Token 到命令行、shell 配置、`.env` 或问题单。

## 9. Mock UI 与回归检查

Mock 不需要真实 SDK 凭证，可用于检查界面和状态机：

```bash
npm run lint
npm run test
npm run start:mock
```

在界面中验证：初始化、登录、入会、离会、登出和反初始化。窗口应显示：

```text
Mock SDK：当前不是真实 Linux SDK 环境
```

## 10. 常见问题

- **`真实 Linux SDK 仅支持 linux/arm64`**：当前设备或架构不符合要求。
- **`不是 ELF64` / `e_machine` 非 183**：SDK 包或某个运行时文件不是 ARM64，重新获取正式包。
- **缺少 `.so`、`Release/` 或符号链接断裂**：重新运行 `npm run sdk:import` 和 `npm run sdk:verify`，不要拼凑资源。
- **addon 加载失败**：确认先执行第 6 节，且 Electron 为项目固定的 `33.4.11`。
- **Wayland 问题**：先切换到 X11 重试；不要修改系统全局图形配置。

## 11. 提交代码前

SDK 资源永远不提交。只提交代码和文档前执行：

```bash
npm run lint
npm run test
npm run github:preflight
git status
git ls-files
```

若提交前检查提示疑似凭证、本机路径、`.env`、SDK 二进制或大文件，先移除或取消跟踪这些文件；不要用 force push 或跳过 Git hooks。
