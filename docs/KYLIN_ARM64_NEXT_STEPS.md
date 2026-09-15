# 麒麟 V10 SP1 ARM64：SDK POC 与打包操作指南

> 适用项目：`electron-app-linux`
> 目标系统：Kylin V10 SP1 ARM64
> SDK 版本：Linux ARM64 `3.26.100.14`
> 当前阶段：SDK 导入与原生 POC；真实鉴权、完整会议功能和最终 AppImage 尚待后续阶段完成

> 已确认实机基线：Kylin Desktop V10 SP1、`aarch64`、glibc `2.31`、Git `2.25.1`、Wayland，`/home` 约剩余 68 GB。项目位于 `/home/ctf/Dev/electron-app-linux`，SDK 包位于 `/home/ctf/sdk-packages/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz`。可以先导入和编译；若 SDK 初始化或窗口问题出现，优先切换 X11/Xorg 验证，禁止修改系统全局 Wayland/X11 配置。

## 1. 当前可以完成什么

目前可以在麒麟电脑完成：

1. 从私有 GitHub 克隆代码；
2. 安装 Node.js 和原生编译环境；
3. 下载 Linux ARM64 SDK 正式包；
4. 导入并校验 SDK；
5. 针对 Electron 编译 ARM64 addon；
6. 运行无凭证 POC；
7. 使用 SDK ID/SDK Token 验证初始化和反初始化；
8. 运行 Mock UI。

当前暂不能完整验证：

- 业务账号密码登录；
- ID Token/SSO 登录；
- 真实入会和会中功能；
- 最终 AppImage 交付包。

这些能力将在原生 POC 通过后继续开发。

> Linux 不需要复制 Mac/Windows 的登录文件。后续正式客户端运行时会连接相同后端，使用相同业务账号密码，由主进程获取 SDK Token、ID Token 和 SSO URL。

---

## 2. 终端操作约定

终端显示的提示符例如：

```text
cft@cft-pc:~$
```

提示符不需要输入，只输入代码块中的命令。

注意：

- 输入一条命令后按 Enter；
- Linux 终端通常使用 `Ctrl+Shift+V` 粘贴；
- `sudo` 输入密码时不会显示字符或星号，这是正常现象；
- 命令失败后先停止，不要继续执行后续步骤；
- 不要使用 `sudo npm ci` 或 `sudo npm install`；
- `<YOUR_...>` 是占位符，必须替换为实际内容。

---

## 3. 检查麒麟系统

### 3.1 开始记录终端日志

```bash
mkdir -p "$HOME/tmsdk-poc-logs"
```

```bash
script -a "$HOME/tmsdk-poc-logs/setup-$(date +%Y%m%d-%H%M%S).log"
```

后续输入 `exit` 可以结束日志记录。

不要在日志中输入或输出 GitHub PAT、SDK Token、密码或完整 SSO URL。

### 3.2 查看系统版本

```bash
cat /etc/os-release
```

确认系统为 Kylin V10 SP1。

### 3.3 查看 CPU 架构

```bash
uname -m
```

预期结果：

```text
aarch64
```

如果输出 `x86_64`，立即停止；当前 SDK 不能用于该机器。

### 3.4 查看 glibc

```bash
getconf GNU_LIBC_VERSION
```

记录输出，后续排查 `GLIBC_x.y not found` 时需要。

### 3.5 查看 X11/Wayland

```bash
echo "${XDG_SESSION_TYPE:-unknown}"
```

首期推荐：

```text
x11
```

如果输出 `wayland`，可以继续环境准备；真实 SDK POC 出现窗口或初始化问题时，优先切换到 X11/Xorg 会话重新测试。

### 3.6 查看磁盘空间

```bash
df -h "$HOME"
```

SDK 和构建产物较大，建议至少保留数 GB 空间。

---

## 4. 安装编译环境

### 4.1 确认包管理器

```bash
command -v apt
```

如果返回 `/usr/bin/apt`，使用下面的 apt 命令。

也可以检查：

```bash
command -v dnf
```

```bash
command -v yum
```

本文后续以麒麟常见的 apt 环境为主。

### 4.2 更新软件索引

```bash
sudo apt update
```

### 4.3 安装最小编译工具

```bash
sudo apt install -y ca-certificates curl python3 make gcc g++ pkg-config xz-utils file binutils
```

### 4.4 验证工具

```bash
git --version
```

```bash
python3 --version
```

```bash
gcc --version
```

```bash
g++ --version
```

```bash
make --version
```

如果任意命令提示 `command not found`，先解决该工具的安装问题，不要继续编译。

---

## 5. 安装或检查 Node.js ARM64

### 5.1 检查现有版本

```bash
node --version
```

```bash
npm --version
```

```bash
node -p "process.arch"
```

满足以下条件即可继续：

- Node.js 18 或 20；
- `process.arch` 输出 `arm64`。

推荐 Node.js 20 LTS ARM64。

### 5.2 手动安装 Node.js 20 ARM64

如果没有 Node.js 或版本太低，执行以下步骤。

进入临时目录：

```bash
cd /tmp
```

设置版本：

```bash
NODE_VERSION=v20.19.5
```

设置文件名：

```bash
NODE_ARCHIVE="node-${NODE_VERSION}-linux-arm64.tar.xz"
```

下载 Node.js：

```bash
curl -fLO "https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}"
```

下载 SHA-256 清单：

```bash
curl -fLO "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
```

校验下载文件：

```bash
grep " ${NODE_ARCHIVE}$" SHASUMS256.txt | sha256sum -c -
```

预期：

```text
node-v20.19.5-linux-arm64.tar.xz: OK
```

创建安装目录：

```bash
sudo mkdir -p "/opt/node-${NODE_VERSION}"
```

解压：

```bash
sudo tar -xJf "$NODE_ARCHIVE" -C "/opt/node-${NODE_VERSION}" --strip-components=1
```

创建命令链接：

```bash
sudo ln -sf "/opt/node-${NODE_VERSION}/bin/node" /usr/local/bin/node
```

```bash
sudo ln -sf "/opt/node-${NODE_VERSION}/bin/npm" /usr/local/bin/npm
```

```bash
sudo ln -sf "/opt/node-${NODE_VERSION}/bin/npx" /usr/local/bin/npx
```

刷新命令缓存：

```bash
hash -r
```

验证：

```bash
node --version
```

```bash
npm --version
```

```bash
node -p "process.arch"
```

`process.arch` 必须输出：

```text
arm64
```

---

## 6. 克隆私有 GitHub 仓库

### 6.1 创建工作目录

```bash
mkdir -p "$HOME/workspace"
```

```bash
cd "$HOME/workspace"
```

### 6.2 Clone

在 GitHub 的 `electron-app-linux` 仓库页面点击 **Code**，复制 HTTPS 地址，然后执行：

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL> electron-app-linux
```

例如：

```text
https://github.com/你的用户名/electron-app-linux.git
```

私有仓库认证说明：

- `Username` 输入 GitHub 用户名；
- `Password` 输入 GitHub Personal Access Token，而不是普通密码；
- 不要把 PAT 写入 clone URL、脚本或文档；
- 如果组织启用了 SSO，需要在 GitHub 网页授权 PAT。

### 6.3 进入项目

```bash
cd "$HOME/workspace/electron-app-linux"
```

确认目录：

```bash
pwd
```

确认文件：

```bash
ls
```

应能看到：

```text
package.json
package-lock.json
README.md
DEVELOPMENT.md
docs
scripts
src
```

查看当前分支：

```bash
git branch --show-current
```

查看提交：

```bash
git log -1 --oneline
```

查看 npm scripts：

```bash
npm pkg get scripts
```

确认存在以下脚本后再继续：

- `sdk:import`
- `sdk:verify`
- `sdk:reset-incomplete`
- `sdk:stage`
- `build:native:linux-arm64`
- `verify:runtime`
- `poc:linux-arm64`
- `start:mock`
- `lint`
- `test`

---

## 7. 下载 SDK 正式包

### 7.1 创建 SDK 保存目录

SDK 不放入 Git 项目目录，统一保存到：

```bash
mkdir -p "$HOME/sdk-packages"
```

目标路径：

```text
$HOME/sdk-packages/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz
```

### 7.2 使用浏览器下载

通过已授权的腾讯会议 SDK 正式下载地址下载：

```text
TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz
```

腾讯会议公开 GitHub 仓库仅包含文档，不包含正式 SDK 二进制。

### 7.3 查找下载文件

```bash
find "$HOME" -maxdepth 4 -type f -name "TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz" 2>/dev/null
```

浏览器通常保存到：

```text
$HOME/下载
```

或者：

```text
$HOME/Downloads
```

### 7.4 移动 SDK 包

将 `<上一步找到的完整路径>` 替换为实际路径：

```bash
mv "<上一步找到的完整路径>" "$HOME/sdk-packages/"
```

示例中的占位符不能原样输入。

### 7.5 设置 SDK 路径

```bash
export TMSDK_PACKAGE_PATH="$HOME/sdk-packages/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz"
```

检查文件：

```bash
test -f "$TMSDK_PACKAGE_PATH" && echo "SDK 包存在" || echo "SDK 包不存在"
```

检查大小：

```bash
ls -lh "$TMSDK_PACKAGE_PATH"
```

记录 SHA-256：

```bash
sha256sum "$TMSDK_PACKAGE_PATH" | tee "$HOME/sdk-packages/TMSDK_3.26.100.14.sha256"
```

不要直接执行 SDK 包内的 Shell 脚本或二进制。

---

## 8. 安装项目依赖

回到项目：

```bash
cd "$HOME/workspace/electron-app-linux"
```

安装依赖：

```bash
npm ci
```

不要使用：

```text
sudo npm ci
```

运行代码检查：

```bash
npm run lint
```

运行测试：

```bash
npm run test
```

如果 `npm ci`、Lint 或测试失败，先停止并保存完整错误输出。

---

## 9. 导入和验证 SDK

确认 SDK 路径变量存在：

```bash
echo "$TMSDK_PACKAGE_PATH"
```

这里输出的是文件路径，不是 Token。

### 9.1 导入

```bash
npm run sdk:import
```

预期生成：

```text
sdk/linux-arm64/3.26.100.14/
native/
├── wemeet.cpp
├── jsoncpp.cpp
└── json/
    ├── json.h
    └── json-forwards.h
```

如果 GNU tar 在导入时对 `Release/plugins` 下大量文件报告“归档中找不到”，这是旧版导入器重复传入父目录和子成员导致。拉取包含 `fix: support GNU tar SDK extraction` 的修复后，直接重新执行 `npm run sdk:import`；不要手工补 `iconengines`、Wayland Qt 插件或其他 `.so`，也不要修改 SDK 包。

新版导入日志会显示 tar 版本、归档成员总数、安全选中成员数、实际提取项数量及列表。归档显式包含 `SDK/include/`、`SDK/Release/` 及 `Electron_Demo/include/json/` 三个目录成员时，实际提取项**精确为 9 个**；若目录成员缺失，导入器会输出 fallback 提示并使用受限成员清单。导入必须包含同版本 `wemeet.cpp`、`jsoncpp.cpp`、`json.h` 与 `json-forwards.h`；不要手工从系统或其他 SDK 版本补 JsonCpp。

若旧版导入已存在但缺少 JsonCpp，确认没有需要保留的 native 修改后执行：

```bash
npm run sdk:reset-incomplete -- --confirm
npm run sdk:import
npm run sdk:verify
```

清理工具遇到 `native/` 未知文件会拒绝删除，需先人工核查。

### 9.2 校验

```bash
npm run sdk:verify
```

校验内容包括：

- `.so` 和官方 `.node` 为 ELF64；
- CPU 架构为 AArch64；
- 文件权限正确；
- 符号链接没有断裂或逃逸；
- manifest SHA-256 匹配。

如果 `sdk:verify` 失败，不要开始编译。

---

## 10. 编译 Electron ARM64 addon

```bash
npm run build:native:linux-arm64
```

预期生成：

```text
output/linux-arm64/wemeet_electron_sdk.node
```

检查文件：

```bash
file output/linux-arm64/wemeet_electron_sdk.node
```

预期包含：

```text
ELF 64-bit
ARM aarch64
```

检查动态依赖：

```bash
ldd output/linux-arm64/wemeet_electron_sdk.node
```

输出中不应有：

```text
not found
```

检查 RPATH/RUNPATH：

```bash
readelf -d output/linux-arm64/wemeet_electron_sdk.node | grep -E "RPATH|RUNPATH"
```

预期包含 `$ORIGIN`。

如果编译失败，不要从网上随意下载 `.so`，也不要复制系统库到 SDK 目录。

---

## 11. 准备和验证 Runtime

### 11.1 Staging

```bash
npm run sdk:stage
```

检查运行目录：

```bash
ls -la output/linux-arm64
```

必须包含：

```text
wemeet_electron_sdk.node
libwemeetsdk.so
libwemeet_base.so
saas_sdk_env.json
Release/
```

### 11.2 Runtime 校验

```bash
npm run verify:runtime
```

只有校验成功后才能执行 POC。

---

## 12. 无凭证 POC

先不要设置 SDK ID 和 SDK Token。

```bash
npm run poc:linux-arm64
```

预期验证：

- Linux Runtime 准备成功；
- addon 加载成功；
- 可以读取 SDK 版本；
- 可以枚举 addon 导出接口；
- 没有凭证时安全停止。

无凭证 POC 不会完成 SDK 初始化或登录。

重点保留：

- SDK 实际版本；
- addon 加载结果；
- `.so not found` 错误；
- `GLIBC` 或 `GLIBCXX` 错误。

---

## 13. 可选：初始化/反初始化 POC

该步骤需要 SDK ID 和 SDK Token，但不需要 ID Token。

### 13.1 输入 SDK ID

```bash
read -r -p "请输入 SDK ID: " TMSDK_ID
```

```bash
export TMSDK_ID
```

### 13.2 隐藏输入 SDK Token

```bash
read -r -s -p "请输入 SDK Token: " TMSDK_TOKEN
```

输入完成后按 Enter，再执行：

```bash
echo
```

```bash
export TMSDK_TOKEN
```

### 13.3 执行 POC

```bash
npm run poc:linux-arm64
```

预期验证：

- `AddJsCallback`；
- `InitWemeetSDK`；
- `OnSDKInitializeResult`；
- `UninitWemeetSDK`；
- `OnSDKUninitializeResult`。

### 13.4 清理凭证

```bash
unset TMSDK_ID TMSDK_TOKEN
```

不要执行：

```text
echo "$TMSDK_TOKEN"
```

### 13.5 ID Token 说明

当前 POC 不需要手工输入 ID Token。

后续正式登录流程：

```text
用户输入业务账号密码
→ 客户端调用现有业务后端
→ 获取 Access/Refresh Token
→ 获取 SDK ID/SDK Token
→ 初始化 SDK
→ 获取 ID Token/SSO URL
→ 主进程调用 Linux SDK Login
```

用户体验与 Mac/Windows 一致，ID Token 不由用户手工输入。

---

## 14. 运行 Mock UI

```bash
npm run start:mock
```

Mock 只验证：

- UI；
- 导航；
- 状态机；
- 模拟初始化、登录、入会和退出。

Mock 成功不代表真实 SDK 成功。

关闭窗口即可结束；必要时在终端按 `Ctrl+C`。

---

## 15. 当前阶段的打包边界

先查看是否已有打包脚本：

```bash
npm pkg get scripts
```

只有存在 `dist:linux:arm64` 时，才可以执行：

```bash
npm run dist:linux:arm64
```

如果脚本不存在，不要自行猜测 electron-builder 参数。当前应先完成：

1. 原生 POC；
2. 真实业务鉴权；
3. SDK 登录；
4. 会议功能；
5. AppImage SDK 资源配置；
6. 打包后权限和符号链接检查。

推荐顺序：

```text
完成 POC
→ 将结果带回开发环境
→ 完成鉴权和会议功能
→ 推送 GitHub
→ 麒麟 git pull
→ 最后构建 AppImage
```

---

## 16. 后续 AppImage 打包流程

当项目后续提供 `dist:linux:arm64` 后执行。

### 16.1 更新代码

```bash
cd "$HOME/workspace/electron-app-linux"
```

```bash
git pull --ff-only
```

### 16.2 更新依赖

```bash
npm ci
```

### 16.3 重新设置 SDK 路径

每次新开终端后需要重新设置：

```bash
export TMSDK_PACKAGE_PATH="$HOME/sdk-packages/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz"
```

### 16.4 重新导入、编译和校验

```bash
npm run sdk:import
```

```bash
npm run sdk:verify
```

```bash
npm run build:native:linux-arm64
```

```bash
npm run sdk:stage
```

```bash
npm run verify:runtime
```

### 16.5 构建 AppImage

```bash
npm run dist:linux:arm64
```

查找产物：

```bash
find dist -maxdepth 2 -type f -name "*.AppImage" -ls
```

增加执行权限：

```bash
chmod +x dist/*.AppImage
```

运行：

```bash
./dist/*.AppImage
```

如果提示 FUSE 错误，可临时验证：

```bash
./dist/*.AppImage --appimage-extract-and-run
```

不要默认使用 `--no-sandbox`。

---

## 17. 结束日志记录

结束当前 `script` 会话：

```bash
exit
```

查看最新日志：

```bash
ls -lt "$HOME/tmsdk-poc-logs" | head
```

如果发生错误，请保留：

- 失败命令；
- 从命令开始到错误结束的完整输出；
- `uname -m`；
- `getconf GNU_LIBC_VERSION`；
- `node --version`；
- `node -p "process.arch"`；
- `echo "$XDG_SESSION_TYPE"`；
- `ldd output/linux-arm64/wemeet_electron_sdk.node`。

发送日志前检查并删除：

- SDK Token；
- GitHub PAT；
- 账号密码；
- 完整 SSO URL。

---

## 18. 常见问题

### 18.1 `git: command not found`

```bash
sudo apt update
```

```bash
sudo apt install -y git
```

### 18.2 `node: command not found`

按本文“安装 Node.js ARM64”步骤安装，之后执行：

```bash
hash -r
```

### 18.3 Node 架构错误

```bash
node -p "process.arch"
```

如果不是 `arm64`，不能继续构建。

### 18.4 node-gyp 缺少工具

重新检查：

```bash
python3 --version
```

```bash
gcc --version
```

```bash
g++ --version
```

```bash
make --version
```

### 18.5 `.node: cannot open shared object file`

检查：

```bash
ldd output/linux-arm64/wemeet_electron_sdk.node
```

不要从网上随意下载缺失 `.so`。

### 18.6 `GLIBC_x.y not found`

记录：

```bash
getconf GNU_LIBC_VERSION
```

不要手工替换系统 glibc。

### 18.7 `GLIBCXX_x.y not found`

记录：

```bash
strings /usr/lib/aarch64-linux-gnu/libstdc++.so.6 | grep GLIBCXX | tail
```

不要从其他系统复制 `libstdc++.so.6` 覆盖系统文件。

### 18.8 Qt platform plugin 加载失败

检查：

```bash
find output/linux-arm64/Release/plugins -maxdepth 2 -type f | head
```

确认 `QT_PLUGIN_PATH` 由项目 Runtime 设置。不要全局修改系统 Qt 配置。

### 18.9 SDK helper 无执行权限

运行：

```bash
npm run sdk:verify
```

不要盲目对整个 SDK 目录执行 `chmod -R 777`。

### 18.10 `InitializeStateIng ipc connect failed`

通常表示 SDK 子进程未正常启动，重点检查：

- `Release/` 是否完整；
- helper 是否有执行权限；
-动态库是否缺失；
- X11/Wayland 环境是否符合要求。

### 18.11 Wayland 初始化失败

记录：

```bash
echo "$XDG_SESSION_TYPE"
```

首期优先切换到 X11/Xorg 会话测试，不修改系统全局文件。

### 18.12 AppImage/FUSE 错误

先尝试：

```bash
./dist/*.AppImage --appimage-extract-and-run
```

如果解压运行成功，说明主要问题在 FUSE/AppImage 挂载环境，而不是应用本体。

---

## 19. POC 完成检查表

- [ ] 系统为 Kylin V10 SP1；
- [ ] `uname -m` 为 `aarch64`；
- [ ] Git 可用；
- [ ] Node.js 版本符合要求；
- [ ] `process.arch` 为 `arm64`；
- [ ] Python、GCC、G++、make 可用；
- [ ] 私有仓库 clone 成功；
- [ ] SDK 正式包下载成功；
- [ ] SDK SHA-256 已记录；
- [ ] `npm ci` 成功；
- [ ] `npm run lint` 成功；
- [ ] `npm run test` 成功；
- [ ] `npm run sdk:import` 成功；
- [ ] `npm run sdk:verify` 成功；
- [ ] addon 编译成功；
- [ ] `npm run verify:runtime` 成功；
- [ ] 无凭证 POC 可读取 SDK 版本；
- [ ] 有凭证时初始化回调成功；
- [ ] 反初始化回调成功；
- [ ] 日志文件已保存；
- [ ] 未泄露 Token、PAT 或密码。
