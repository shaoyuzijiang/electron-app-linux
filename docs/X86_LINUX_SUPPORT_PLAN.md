# x86 Linux 支持方案（调研与设计 · 待评审）

> 目标：新增 x86_64 Linux demo 链路，使用方式与现有 ARM64（银河麒麟 V10）完全一致；
> **ARM64 现有链路零回归**。本文档为实施依据，评审通过后按分期执行。

## 一、调研结论（基于实物核验，2026-10-21）

| 项 | 结论 |
|---|---|
| x86 SDK 包 | ✅ 已就位：`SDKDev/TMSDK_0300000000_3.26.100.56_x86_64_default.publish.tar.gz`（333MB） |
| 包结构 | ✅ 与 arm64 同构（`SDK/{libwemeetsdk.so, libwemeet_base.so, Release/, include/}` + `Electron_Demo/include/json/`），`Release/tmsdkapp`、`QtWebEngineProcess` 齐全 |
| 库架构 | ✅ `libwemeetsdk.so` 为 ELF x86-64（`file` 实测） |
| **头文件 ABI** | ✅ **3.26.100.56（x86）与 3.26.100.14（arm64）四组头文件逐字节一致**（wemeet_sdk.h / def / interface / json.h）——`native/linux/wemeet.cpp` 无需任何改动 |
| SDK 版本差异 | ⚠️ x86 是 .56、arm64 是 .14（patch 不同步，头文件一致但 .so 运行时行为差异需真机验证） |
| Electron x64 | ⚠️ 需新增供应物 `electron-v33.4.11-linux-x64.zip`（官方同版本直下，非自建） |

## 二、技术路线（复用优先，参数化次之，新增最后）

| 层 | 决策 | 说明 |
|---|---|---|
| 入口分派 `main.js` | **复用** | 加一条 `process.arch === 'x64'` → 同样进 `platform/linux-arm64/main.js`（该 adapter 是纯 JS，不含任何架构假设；目录名遗留问题后续再议，本轮不重命名以免破坏门禁脚本） |
| 能力契约 / IPC / 渲染层 | **复用** | 零改动 |
| native addon（binding.gyp） | **新增条件** | 加 `OS=="linux" and target_arch=="x64"` 分支（复制 arm64 分支，源码相同） |
| x64 预编译 addon | **新增产物** | `packaging/prebuilt/wemeet_electron_sdk.x64.node`，在 x86 基线机编译回传（与 arm64 同模式） |
| SDK 准备 prepare-sdk.sh | **参数化** | 归档 glob 按 arch 参数化：`TMSDK_*_arm64_…` / `TMSDK_*_x86_64_…`；默认值保持 arm64 |
| DEB 打包 build-deb.sh | **参数化** | `ARCH` 变量（arm64→deb `arm64`；x86_64→deb `amd64`）；产物名 `-arm64.deb` / `-x64.deb` |
| 离线脚本族（setup-kylin / install-electron-* / start-linux / check） | **参数化** | `uname -m` 与 readelf 架构检查按目标 arch 放开；arm64 默认行为不变 |
| CI | **新增 job** | `linux-deb-x64`（ubuntu-latest 原生 x86_64，仅组装不编译），发布与清理**按平台+架构后缀隔离** |
| 供应物 | **新增 3 项** | `electron-v33.4.11-linux-x64.zip`、`TMSDK_..._x86_64_...tar.gz`、重新生成的 `SHA256SUMS`（四同步红线：替换供应物必须同步校验文件） |
| 升级脚本 update-linux-sdk.sh | **参数化** | 支持 `-arch arm64|x86_64`（默认 arm64），双归档共存于 vendor/ |
| Release `latest` | **第 4 资产** | `tencent-meeting-sdk-demo-<版本>-<日期>-x64.deb` |

## 三、改动清单（文件级）

| 文件 | 改动 | arm64 影响 |
|---|---|---|
| main.js | +2 行（x64 分派） | 无（arm64 分支不动） |
| binding.gyp | +1 个 linux/x64 条件块 | 无 |
| scripts/prepare-sdk.sh | glob 参数化（`SDK_ARCH` env，默认 arm64） | 默认行为不变 |
| scripts/build-deb.sh | ARCH 参数化（默认 arm64） | 默认行为不变 |
| scripts/build-native.sh | 目标 arch 参数化 + x64 基线校验 | 默认行为不变 |
| scripts/setup-kylin.sh、install-electron-runtime.sh、install-electron-headers.sh、start-linux.sh、check.sh | aarch64/readelf 检查按参数放开 | 默认行为不变 |
| scripts/validate-*.js（3 个门禁） | 适配 x64 存在性（能力契约不变，21 项共用） | 无 |
| update-linux-sdk.sh | `-arch` 参数 | 默认 arm64 不变 |
| .github/workflows/build-all.yml | +linux-deb-x64 job；**arm64 job 清理模式改为 `-arm64.deb` 后缀** | 清理条件收窄（坑 28 教训） |
| .github/workflows/build-deb.yml | 备用通道同步 arch 感知清理 | 同上 |
| packaging/prebuilt/ | +`wemeet_electron_sdk.x64.node`（阶段 B 回传） | 无 |
| docs/X86_LINUX_SUPPORT_PLAN.md | 本文档 | — |

## 四、卡点（按阻塞程度排序）

| # | 卡点 | 影响 | 缓解 |
|---|---|---|---|
| K1 | **x64 addon 编译基线机**：x64 addon 必须在目标 x86 Linux 基线编译（CI ubuntu glibc 过新，直接编会在旧系统崩）。x86 麒麟 V10 的 glibc 版本待实测（可能与 arm64 的 2.31 不同） | 阻塞阶段 B | ① 找一台 x86 麒麟 V10（腾讯渠道通常同时提供 x86 包，大概率有对应机器）② 或验证 docker `ubuntu:20.04`（glibc 2.31）静态化基线可行性 ③ 最保守：`静态链接` 方案评估 |
| K2 | **x86 真机冒烟**：登录/入会/预定/图形三件套（坑 6/7/8）需在 x86 桌面环境重验 | 阻塞阶段 C 验收 | 与 K1 同机解决 |
| K3 | **SDK .56 与 .14 运行时行为差异**：头文件一致但 .so 实现可能有 bug 修复/回归 | 中 | 冒烟覆盖；必要时 x86 侧锁 .56 供应物独立演进 |
| K4 | electron-v33.4.11-linux-x64.zip 需从 electronjs.org 官方下载（GitHub release），体积约 90MB，一次性人工上传 | 低 | 实施时处理 |

## 五、风险评估

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | arm64 链路回归 | **低** | 所有共享改动默认值=arm64；门禁 `verify:platform-contract` + `check --deb` 把关；改造后跑一轮 arm64 CI 对照 |
| R2 | **Release 清理互删**（arm64/x64 两个 deb job） | **高关注** | 坑 28 教训：arm64 job 清理条件必须同步收窄为 `-arm64.deb`，x64 只删 `-x64.deb`；实施清单已列，code review 重点 |
| R3 | x64 addon 基线错配 → 真机 `GLIBC not found` | 中 | 与 arm64 同款防线：构建脚本锁定基线（版本实测后固化）+ readelf 校验 + ADDON_BUILD_PROVENANCE 记录 |
| R4 | 双 DEB 同包名混淆 | 低 | 同包名不同 deb 架构可共存（dpkg 按 Architecture 区分）；产物命名 `-x64.deb` 与 `-arm64.deb` 清晰区分，文档标注 amd64 对应关系 |
| R5 | CI 额度增加 | 低 | x64 job 是 Linux runner（×1），每次 main push 约 +4-5 计费分钟；paths-ignore 免构建机制不受影响 |
| R6 | SDK 双版本（.56/.14）认知成本 | 低 | update-linux-sdk.sh 按 arch 分开升级，sdk-version 记录到构建摘要 |

## 六、实施分期

### 阶段 A：链路参数化 + CI 就绪（无需 x86 机器，纯软件改动）
- 三节全部"参数化/新增"类改动；x64 job 先以"缺预编译 addon 则明确跳过"方式合入
- 验收：arm64 三端 CI 全绿（零回归对照）+ x64 job 呈现明确的"等待 addon"状态

### 阶段 B：x64 addon 产出（依赖 K1 基线机）
- x86 基线机编译 → `output/linux/wemeet_electron_sdk.node` 回传 `packaging/prebuilt/wemeet_electron_sdk.x64.node`
- 供应物上传（electron-x64 zip、x86 SDK tar.gz、SHA256SUMS 重算）
- 验收：x64 job 全绿，产出 `-x64.deb`

### 阶段 C：真机验收（依赖 K2 机器）
- x86 机器安装冒烟，标准与 arm64 一致（参照 docs/LINUX_TEST_PLAN.md 全量）
- 验收：**x86 Linux 使用方式与 ARM64 完全一致**——同一入口（GitHub Releases）、
  同一安装方式（`sudo dpkg -i`）、同一桌面图标启动、同一组功能

## 八、实施结果（阶段 A，本地验证 2026-10-21）

> 分支 `feat/x86-linux`（**未推送 GitHub**，按约定本地先行）。10 文件改动。

### 8.1 已完成与实测

| 项 | 结果 |
|---|---|
| main.js x64 分派（复用 adapter） | ✅ |
| binding.gyp linux/x64 条件块 | ✅（本机无法编 Linux addon，真编在基线机做） |
| prepare-sdk 按 SDK_ARCH 双架构 | ✅ 实测：arm64→ARM aarch64 ELF / x86_64→x86-64 ELF |
| build-deb.sh LINUX_ARCH 参数化 | ✅ 实测组装两种 DEB |
| x64 DEB 本地出包 | ✅ 265MB；`dpkg-deb` 验证 Architecture=amd64、SDK lib 与 electron 均 x86-64、desktop/adapter 结构完整 |
| **arm64 DEB 回归** | ✅ 全真素材组装成功，Architecture=arm64、SDK lib ARM aarch64 |
| 门禁回归 | ✅ `verify:platform-contract` 全绿 |
| update-linux-sdk.sh 双架构 | ✅ `--arch x86_64` dry-run + 非法 arch 拒绝 |
| CI（build-all.yml） | ✅ 新增 linux-deb-x64 job：addon 未就位时 `::warning` 跳过组装（OUTPUT_EXISTS 门控），不阻塞其他平台；arm64/x64 清理后缀隔离（`-arm64.deb` / `-x64.deb`，坑 28 对策） |

**说明**：本地 x64 DEB 内的 addon 为 arm64 占位文件（本机无 Linux 编译途径），
仅验证打包流水线与结构；**真 x64 addon 必须由 x86 麒麟基线机产出（阶段 B，卡点 K1 未解）**。

### 8.2 实施中新踩的坑（已回写 PITFALLS）

- 坑 31：`set -o pipefail` + glob 不匹配的 `ls` 管道 → 脚本静默退出
  （prepare-sdk/setup-kylin/update-linux-sdk 三处同款，已统一 `{ ls … \|\| true; }`）
- 坑 32：macOS BSD `install` 无 `-D`（build-deb.sh 已去 `-D`）；brew `dpkg-deb` 只能打包不能安装

### 8.3 x64 addon 容器化 CI 产出（新增，替代"必须真机编译"）

**结论：x64 addon 不需要 x86 真机编译。** 新增 `.github/workflows/build-addon-x64.yml`
（仅 `workflow_dispatch` 手动触发，不占 push 额度）：

- `ubuntu:20.04` 容器 = **glibc 2.31 基线**，与 arm64 麒麟基线策略一致（N5）
- 供应物三件套（x86 SDK 归档 / 离线 Electron headers / SHA256SUMS）均已在
  `vendor-supplies`，CI 内校验后 `TARGET_ARCH=x64 bash scripts/build-native.sh` 编译
- 基线防线不放宽：build-native.sh 新增 `ADDON_BASELINE_OVERRIDE` 开关——
  跳过 Kylin 检查但 **glibc 2.31 检查永远保留**
- 产物挂 Artifacts `linux-addon-x64`，人工回传
  `packaging/prebuilt/wemeet_electron_sdk.x64.node` 提交后，deb job 自动激活
- **待实测确认**：x86 麒麟 V10 的实际 glibc 版本。若 < 2.31，把容器镜像换成
  `ubuntu:18.04`（glibc 2.27，向下兼容面更大）重跑即可——workflow 注释已标注

### 8.4 实施结果终版（2026-10-21，阶段 A+B 完成）

**CI 过程中修了 4 个问题**（全程记录）：

1. ubuntu:20.04 无 `gh` 包 → 官方 keyring 源安装（已固化进 workflow）
2. `node-v33.4.11-headers.tar.gz` 供应物从未上传 vendor-supplies → 已补传 + SHA256SUMS
3. readelf Machine 输出 `X86-64`（大写 X）与校验 `*x86-64*` 大小写不匹配 → 校验改不敏感
4. `check.sh:13` arm64 归档 glob 的 pipefail 静默退出（坑 31 漏网，x64 job 环境 vendor
   只有 x86_64 归档时触发）→ 全局补 `|| true`；同款修复 build-deb.sh 描述行

**最终验证（run 39568445076，四 job 全绿）**：

| 项 | 结果 |
|---|---|
| 四端 CI | linux-deb / **linux-deb-x64** / mac-dmg / win-nsis 全绿 |
| Release `latest` | 四资产共存：`…-arm64.deb`、`…-x64.deb`、`…-mac-arm64.dmg`、`…-win-x64.exe`，连续发布互不误删 |
| x64 DEB 抽查 | addon / SDK lib / electron 三件二进制均 **ELF x86-64**；Architecture=amd64；Version=3.45.100 |
| addon 真实性 | `wemeet_electron_sdk.x64.node`（435KB）来自 build-addon-x64 run 39565902447 容器产出，非占位 |

### 8.5 x86 机器安装与运行指南

```bash
# 1. 下载（Releases → latest → tencent-meeting-sdk-demo-<版本>-<日期>-x64.deb）
sudo dpkg -i tencent-meeting-sdk-demo-*.deb
# 2. 依赖缺口自动补齐（DEB 已声明 Depends：libc6/libstdc++6/libgtk-3-0/libnss3/libasound2 等）
sudo apt-get install -f
# 3. 启动：桌面图标"腾讯会议SDK Demo"，或命令行
tencent-meeting-sdk-linux-demo
```

**跑起来的前提**（缺一即用不了，均在真机首次验收时确认）：

| 前提 | 说明 |
|---|---|
| glibc ≥ 2.31 | addon 以 ubuntu:20.04（glibc 2.31）编译。**若目标系统 glibc 更低**
  （如麒麟 x86 V10 实测为 2.28），报 `GLIBC_2.31 not found`，
  解决：build-addon-x64.yml 容器镜像换 ubuntu:18.04 重编（版本更低向下兼容面更大） |
| 图形栈 | X11 或 Wayland+XWayland（与 arm64 相同经验，坑 6/7/8 图形三件套） |
| 依赖库 | `sudo apt-get install -f` 自动补；离线环境需按 Depends 清单预置 |
| 网络/后端 | 与 arm64 相同（后端 API 动态签发 Token） |

### 8.6 待办（阶段 C）

- [ ] 推送分支 → 手动触发 `build-addon-x64` → 回传 addon 提交（阶段 B 核心步）
- [ ] K4：electron-v33.4.11-linux-x64.zip 与 x86 SDK 归档上传 vendor-supplies + 重算 SHA256SUMS
- [ ] x64 job 首跑全绿（main push 或手动触发）
- [ ] K2：x86 真机全量冒烟（LINUX_TEST_PLAN）+ 基线 glibc 版本实测
- [ ] 本分支评审后合入 main（首次 main push 将跑 4 个 Linux/mac/win job）

- [ ] arm64 三端 CI 全绿（与改造前对照，零回归）
- [ ] x64 job 全绿并稳定产出 `-x64.deb`
- [ ] Release `latest` 四资产共存且互不误删（连续两次发布验证清理隔离）
- [ ] x86 真机：安装/启动/登录/入会/预定冒烟通过（含图形三件套）
- [ ] `update-linux-sdk.sh` 双架构升级演练各一次
- [ ] 本文档补"实施结果"节
