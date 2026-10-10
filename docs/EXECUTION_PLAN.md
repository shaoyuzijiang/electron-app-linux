# 合并演练执行方案（EXECUTION PLAN · 唯一执行基线）

> **文档地位**：本文档是后续架构、代码更改、任务分解、测试与打包的**唯一执行依据**。
> 前置文档 `docs/MERGE_REHEARSAL_PLAN.md`（v2 施工图）中与本文冲突之处，以本文为准。
> 执行者无需阅读前期讨论，按本文顺序执行即可。
>
> **已确认的决策**（2026-10-10，与 owner 对齐）：
> 1. 版本对齐（SDK 3.43 → 3.45）**延后到最后**（阶段 4 前置任务 T7），本轮演练不做
> 2. 供应物包本机已具备，**暂不下载、暂不上传**；代码（workflow）完成后统一处理
> 3. 上游（Mac/Win）最新仓库：`https://github.com/carlliu67/electron-app`
> 4. 阶段 4 的 framework 上传不着急，等演练全绿后另行安排

---

## 〇、背景速览

| 项 | 内容 |
|---|---|
| 产品 | 腾讯会议 SDK Electron 桌面客户端（原生 .node 插件 + 自研后端 HTTP API） |
| 本仓库 | `shaoyuzijiang/electron-app-linux` —— Linux ARM64（麒麟 V10）完整版 + 三端统一架构 |
| 上游仓库 | `carlliu67/electron-app` —— Mac/Windows 版（Electron + 3.43 SDK） |
| 分叉点 | `6c881fd`（历史同源，标准 PR/merge 可合并） |
| 上游现状 | **分叉点之后已有 1 个新提交 `7bde5ce`（SDK 升级 3.45.100）**——本轮不处理，见 T7 |
| Electron | 三端统一 33.4.11（本仓库 package.json 已精确锁定；上游仍为 ^33.4.11 / node-gyp 33.0.0，合并时统一） |
| 自动化现状 | push main → 现有 `.github/workflows/build-deb.yml` 自动出 Linux ARM64 DEB → 发布 Release `latest` |

### 关键目录职责（本仓库，已落地，不改动）

| 路径 | 职责 |
|---|---|
| main.js | 平台分派入口（8 行）：linux-arm64 → platform 主进程；否则 → main-darwin-win32 |
| main-darwin-win32.js | mac/win 共享主进程：窗口、scheme 唤起、IPC、SDK 生命周期 |
| ipc-handlers.js | 约 100 个 ipcMain.handle 通道 |
| bootstrap/preload.js | contextBridge 暴露 132 个通道（渲染层唯一入口） |
| backend_api/ | 通用 HTTP（RSA+AES）、auth 登录、api.js re-export |
| sdk_mgmt/wemeet-sdk.js | mac/win 原生 SDK 装载、Token 管理、回调桥 |
| renderer/ | 三端共享 UI |
| platform/linux-arm64/ | Linux 主进程 + SDK 3.26 adapter + 安全 IPC |
| common/contracts/ | 跨平台能力契约（21 项，UI 显隐唯一依据） |
| native/linux/ | Linux SDK C++ N-API 封装源码 |
| packaging/ | DEB 资源 + 预编译 addon（`packaging/prebuilt/wemeet_electron_sdk.arm64.node`） |
| scripts/ | 构建/检测/打包脚本（check.sh 统一检测入口） |

### main.js 结构结论（已评审，禁止改动）

- mac/win 之间的参数级差异：同文件 if 分支，保留在 `main-darwin-win32.js`（326-363 行）
- Linux 属架构级差异：维持当前 8 行分派入口，不变

---

## 一、需求目标

1. 在**不接触上游 electron-app 仓库**的前提下，于本仓库内完成三端（Linux/mac/win）CI 构建演练
2. 三 job 全绿 + 真机冒烟通过，证明合并可行性
3. 不破坏 main 现有发布链路（Release `latest` 零回归）
4. 演练绿后，阶段 4 由 owner 放行再执行正式 PR（本文只做前置准备）

## 二、范围与不变式

**本轮唯一新增物**：`.github/workflows/build-all.yml` + 演练分支 `rehearse/electron-app-merge`。
**除上述外，不改任何业务代码、不改 main.js / package.json / binding.gyp。**

不变式（任何改动不得违反）：

- I1 main 分支的现有构建发布链路行为不变
- I2 Electron 三端锁定 33.4.11，node-gyp `--target` 一致（本轮已满足，无改动）
- I3 Linux addon 用 glibc 2.31 基线预编译产物，CI 只组装不编译
- I4 `vendor-supplies` 与 `latest` 两个 Release 职责分离，互不覆盖
- I5 演练产物只挂 Actions Artifacts，不发布 Release
- I6 凭据/Token/密钥不入库、不进产物；不调用 ldd 探测 SDK 私有库（用 readelf）
- I7 麒麟侧全程普通用户操作，禁止 sudo npm、禁止 --no-sandbox

---

## 三、供应物清单（本轮不下载、不上传，代码完成后统一处理）

Release tag `vendor-supplies`（本仓库）当前已有 2 项资产（勿动）：

| 资产 | 状态 |
|---|---|
| `TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz`（277MB） | ✅ 已在 Release |
| `electron-v33.4.11-linux-arm64.zip`（106MB） | ✅ 已在 Release |

待补资产（owner 手头已有包，**本轮先不上传**，等 T2-T3 代码完成后统一处理）：

| 资产名 | 来源 | 用途 | 优先级 |
|---|---|---|---|
| `TMSDK.framework.arm64.zip` | `/Users/yangzijian/SDKDev/electron-app/wemeet_sdk/mac/Frameworks/arm64/TMSDK.framework`（408MB，已确认存在） | mac job 编译 Headers + 打包 Framework | **必需**（缺则 mac job 红） |
| `TMSDK.framework.x86_64.zip` | Mac SDK 分发包内 `SDK包/` 目录 | mac x64 构建备用 | 可选 |
| `wemeet-sdk-win-x64-runtime.zip` | 暂未定位到本机路径（待 owner 提供包） | win job 编译 + 运行 | 缺则 win job 降级（见 T5 降级方案） |

win runtime zip 内部结构（解压后必须与仓库路径吻合）：

```
wemeet_sdk/win/
├── include/            # SDK C++ 头文件（编译需要）
├── lib/x64/release/wemeetsdk_x64.lib
└── x64/                # 运行时（打包需要）
    ├── wemeet_electron_sdk.node
    ├── wemeetsdk_x64.dll、wemeet_base.dll 等
    └── Release/
```

上传命令（届时执行；mac Framework 示例）：

```bash
cd /Users/yangzijian/SDKDev/electron-app/wemeet_sdk/mac/Frameworks/arm64
zip -qry /tmp/TMSDK.framework.arm64.zip TMSDK.framework
gh release upload vendor-supplies /tmp/TMSDK.framework.arm64.zip --clobber \
  -R shaoyuzijiang/electron-app-linux
```

命名规范：构建产物统一 `腾讯会议SDK Demo-<版本>-<日期>-arm64.deb`；
GitHub Release 资产用 ASCII 名 `tencent-meeting-sdk-demo-<版本>-<日期>-arm64.deb`（中文会被强制清洗）。

---

## 四、变更清单（唯一的代码改动）

### C1 新建 `.github/workflows/build-all.yml`

内容为第六节 YAML 全文，直接复制。要点：

- linux job：main 由现有 `build-deb.yml` 负责正式构建发布；演练分支/手动触发由本 workflow 兜底（不发布）
- mac job：`macos-14`（arm64）现场 node-gyp 编译 addon，electron-builder 打 dmg，`SKIP_SIGN=1`
- win job：`windows-2022`（自带 VS2022 + Python）编译 addon，electron-builder 打 nsis
- 三 job 均有 `if: github.ref != 'refs/heads/main'` 守卫（I5）

### C2 新建分支 `rehearse/electron-app-merge`

main 的完整拷贝，所有演练改动在此分支。**注意：基于本仓库 main（即分叉点 6c881fd 一侧），
不 rebase 上游 7bde5ce**——版本对齐延后（T7）。

除 C1/C2 外无任何代码改动。

---

## 五、任务分解（按序执行）

### T1 创建演练分支

```bash
cd /Users/yangzijian/SDKDev/electron-app-linux
git checkout main && git pull origin main
git checkout -b rehearse/electron-app-merge
git push -u origin rehearse/electron-app-merge
```

### T2 落地 workflow

- 写入 `.github/workflows/build-all.yml`（第六节全文）
- 本地校验 YAML（红线 N13）：

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-all.yml'))"
```

- 提交（多行提交信息用 `printf '标题\n\n正文\n' | git commit -F -`，不用 `-m "a\nb"`）：

```bash
git add .github/workflows/build-all.yml
printf 'ci: 新增三端演练构建 workflow（build-all.yml）\n\nlinux 兜底构建不发布；mac dmg 跳签名；win nsis。\n产物只挂 Artifacts，演练分支与手动触发生效。\n' | git commit -F -
git push
```

### T3 上传供应物（代码完成后统一处理，owner 已备好包）

- 必做：`TMSDK.framework.arm64.zip`（命令见第三节）
- 后补：`wemeet-sdk-win-x64-runtime.zip`（到位前 win job 按第五节降级方案执行）
- 可选：`TMSDK.framework.x86_64.zip`

### T4 触发构建

推送 T2 后自动触发；或在 Actions 页 `build-all-platforms` 手动 Run workflow。

### T5 验收（标准见第七节）

降级方案：若 `wemeet-sdk-win-x64-runtime.zip` 暂缺，win job 整体加 `if: false`
（仅保留 addon 编译验证则只注释打包步骤），本轮先跑 mac + linux。

### T6 记录演练结论

- 回写本文档，追加"九、演练结果"小节（三 job 结论、产物链接、冒烟结果、坑与对策）
- 新问题按红线 N17 回写 `docs/PITFALLS.md`（症状→原因→解决）

### T7 版本对齐（延后任务，阶段 4 前置，本轮不执行）

上游 `7bde5ce` 已将 mac/win SDK 升级至 3.45.100。**实测评估结论（2026-10-10）**：

- 该提交仅改 3 个文件：`package.json`（version 3.43.112→3.45.100）、`package-lock.json`、
  `wemeet_sdk/wemeet.cpp`（+178/-118）。**不含任何头文件 / Framework / 运行时二进制**
- `wemeet.cpp` 改动两类：JsonCpp 用法现代化（自包含）；新 SDK API 适配
- API 兼容性实测：
  - `EnableCustomOrgInfo(bool)`：3.43 头文件已是单参版本 ✅
  - `GetUserInfo`（IAccountService，debug 段）：mac 3.43.112.62 头文件已有 ✅，
    win 3.43.112.5 头文件**缺失** ❌
  - `DeleteVoicePrint` / `CheckVoicePrintIsCollected` / `ShowVoicePrintRecordView`
    （IPreMeetingService）：3.43 双端头文件均**缺失** ❌
- **结论：合并 7bde5ce 后必须用 3.45 SDK 包编译，否则 mac/win addon 编译失败。
  在拿到 3.45 供应物之前，禁止把 7bde5ce 合入演练分支**（会打红现有绿色 CI）

待办（依赖 owner 提供材料）：

- [ ] **材料**：mac TMSDK.framework 3.45.100（arm64）+ win SDK 3.45.100 包
      （include/lib/x64 运行时；SDK 走人工渠道，无公开版本源）
- [ ] 用 3.45 包重做供应物：`TMSDK.framework.arm64.zip`（--clobber 覆盖）
      与 `wemeet-sdk-win-x64-runtime.zip`（按 9.4 节同款重排）
- [ ] 合并上游 main（含 7bde5ce）入演练分支；package.json version 同步 3.45.100
- [ ] N15 三同步核对：package.json electron 版本、node-gyp --target、预编译 addon
      （electron 33.4.11 不随 SDK 升级变化，预计无改动；Linux 侧 SDK 3.26 不受影响）
- [ ] 重跑三端 CI 回归（build-all-platforms 手动触发）

### T8 阶段 4 正式操作（owner 放行后，另行排期）

前置确认：owner 认可 18 个共享文件改动 + 三端 CI 回归方案；
electron-app 重建 vendor-supplies；T7 版本对齐完成。

```bash
git remote add electron-app https://github.com/carlliu67/electron-app.git
git push electron-app rehearse/electron-app-merge:feat/linux-arm64
```

随后在 electron-app 开 PR（feat/linux-arm64 → main），描述引用
`docs/PLATFORM_MERGE_PROPOSAL.md` + 演练绿色结果；PR CI 三端全绿 → owner merge；
合并后供应物迁移至 electron-app Release，build-all.yml / build-deb.yml 一并合入接管打包。

---

## 六、build-all.yml 全文（直接复制）

```yaml
name: build-all-platforms

on:
  workflow_dispatch:
  push:
    branches:
      - main
      - rehearse/electron-app-merge

permissions:
  contents: read

jobs:
  linux-deb:
    if: github.ref != 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: 下载离线供应物
        run: |
          mkdir -p vendor
          base="https://github.com/${GITHUB_REPOSITORY}/releases/download/vendor-supplies"
          curl --fail --location --retry 3 -o vendor/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz "$base/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz"
          curl --fail --location --retry 3 -o vendor/electron-v33.4.11-linux-arm64.zip "$base/electron-v33.4.11-linux-arm64.zip"
      - name: 安装依赖
        run: npm ci --include=dev --ignore-scripts
      - name: 门禁测试
        run: npm run verify:platform-contract
      - name: 准备 SDK 与预编译 addon
        run: |
          mkdir -p sdk-extract output/linux
          tar -xzf vendor/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz -C sdk-extract
          bash scripts/prepare-sdk.sh "$(echo sdk-extract/TMSDK_*)"
          cp packaging/prebuilt/wemeet_electron_sdk.arm64.node output/linux/wemeet_electron_sdk.node
      - name: 组装 DEB
        run: WEMEET_CI=1 bash scripts/build-deb.sh
      - name: 校验 DEB
        run: npm run check -- --deb
      - name: 上传产物
        uses: actions/upload-artifact@v4
        with:
          name: linux-arm64-deb
          path: dist-demo/*.deb
          if-no-files-found: error

  mac-dmg:
    if: github.ref != 'refs/heads/main'
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: 下载 mac Framework 供应物
        run: |
          mkdir -p wemeet_sdk/mac/Frameworks/arm64 wemeet_sdk/mac/Frameworks/x86_64
          curl --fail --location --retry 3 -o /tmp/TMSDK.framework.arm64.zip "https://github.com/${GITHUB_REPOSITORY}/releases/download/vendor-supplies/TMSDK.framework.arm64.zip"
          ditto -x -k /tmp/TMSDK.framework.arm64.zip wemeet_sdk/mac/Frameworks/arm64/
          ln -s ../arm64/TMSDK.framework wemeet_sdk/mac/Frameworks/x86_64/TMSDK.framework
      - name: 安装依赖
        run: npm ci --include=dev --ignore-scripts
      - name: 编译原生 addon（arm64）
        run: npm run build:native:mac-arm64
      - name: 打包 DMG（跳过签名）
        run: SKIP_SIGN=1 npm run dist:mac:arm64
      - name: 上传产物
        uses: actions/upload-artifact@v4
        with:
          name: mac-arm64-dmg
          path: dist/*.dmg
          if-no-files-found: error

  win-nsis:
    if: github.ref != 'refs/heads/main'
    runs-on: windows-2022
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: 下载 win SDK 运行时供应物
        shell: pwsh
        run: |
          New-Item -ItemType Directory -Force -Path wemeet_sdk\win | Out-Null
          Invoke-WebRequest -Uri "https://github.com/$env:GITHUB_REPOSITORY/releases/download/vendor-supplies/wemeet-sdk-win-x64-runtime.zip" -OutFile win-runtime.zip
          Expand-Archive -Path win-runtime.zip -DestinationPath wemeet_sdk\win -Force
      - name: 安装依赖
        run: npm ci --include=dev --ignore-scripts
      - name: 编译原生 addon（x64）
        run: npm run build:native:win-x64
      - name: 打包 NSIS
        run: npm run dist:win:x64
      - name: 上传产物
        uses: actions/upload-artifact@v4
        with:
          name: win-x64-nsis
          path: dist/*.exe
          if-no-files-found: error
```

### 本 workflow 专属注意点

1. mac/win 的 `npm ci --ignore-scripts` 不写 electron 包的 path.txt，若任何步骤
   require('electron') 报 "Electron failed to install correctly"，参照现有
   `.github/workflows/build-deb.yml` 的"补齐 electron 包元数据"步骤
   （`printf 'electron' > path.txt` 并 `mkdir dist`）。electron-builder 打包会自行下载对应平台 Electron，不受影响。
2. win 解压必须用 PowerShell 的 `Expand-Archive`（Git Bash 无 unzip）。
3. mac 编译期 include_dirs 固定指向 x86_64 Framework 头文件路径（与架构无关），
   必须创建 x86_64 软链指向 arm64 Framework（YAML 已含）。
4. mac job 的 `build:native:mac-arm64` 从 electronjs.org 下载 33.4.11 headers，runner 外网可达。
5. win runtime 暂缺时 win job 加 `if: false` 降级（T5）。
6. 现有正式构建 workflow 的实际文件名是 `.github/workflows/build-deb.yml`
   （前期文档写作 build-linux-deb.yml，同一文件）。

---

## 七、测试与验收标准

执行方式：T3 供应物就位后在 Actions 手动触发或 push 自动触发。

| 检查项 | 通过标准 |
|---|---|
| linux-deb job | 绿 + `linux-arm64-deb` 产物存在；deb 下载后 dpkg -i 可装可卸 |
| mac-dmg job | 绿 + `mac-arm64-dmg` 产物存在；dmg 拷到 mac 可打开（未签名需右键打开），登录/入会/预定冒烟 |
| win-nsis job | 绿 + `win-x64-nsis` 产物存在；exe 安装后登录/入会冒烟（供应物缺失时按降级方案只验编译） |
| 无回归 | Release `latest` 未被演练构建覆盖（发布步骤只在 main 生效） |
| 门禁 | linux job 内 `npm run verify:platform-contract` 通过 |

失败排查优先查 `docs/PITFALLS.md`（CI 类坑 18/22/25，环境类坑 1-5）。

**打包与产物规范**：演练产物只挂 Artifacts（自动压缩为 zip，N10）；
对外分发一律用 Release 资产；传输包（401MB）是构建工具箱、DEB（~277MB）是客户安装包，勿混用（N16）。

---

## 八、回退机制

| 场景 | 动作 | 影响 |
|---|---|---|
| 演练构建失败 | 修分支 / 删分支（`git push origin --delete rehearse/electron-app-merge`） | 零影响，main 未动 |
| 演练通过但决定暂缓 | 分支保留不动 | 零影响 |
| electron-app PR 阶段出问题 | 关 PR / 删远端分支 | 上游 main 未动 |
| PR 合并后发现回归 | revert 合并提交 | 仅回退相关提交 |

---

## 九、演练结果（2026-10-10 回写）

**演练分支** `rehearse/electron-app-merge`，**构建 run** 38034503379（workflow_dispatch 前共 3 轮，详见下）。

### 9.1 执行记录

| 任务 | 结果 |
|---|---|
| T1 演练分支 | ✅ 已推送（基于 main @ eb1b8b6，即分叉点一侧，未 rebase 上游 7bde5ce） |
| T2 build-all.yml | ✅ 已落地并推送（commit bfae4ed + 修复 9f4ac3c） |
| T3 供应物 | ✅ 4 项齐备：Linux SDK 归档、Electron zip（原有）+ TMSDK.framework.arm64.zip（198MB）+ wemeet-sdk-win-x64-runtime.zip（333MB，由 `TMSDK_Windows_3.43.112.5_20260910` 重排打包） |
| T4 触发构建 | ✅ 3 轮迭代后三 job 全绿 |
| T5 验收 | ✅ CI 侧全过；真机冒烟待人工（见 9.3） |

### 9.2 构建迭代与坑

- 第 1 轮（push 触发）：供应物未上传，mac/win 预期性失败
- 第 2 轮（run 38034147145）：
  - linux-deb ❌ 坑 18（electron 元数据）→ 补齐 path.txt 步骤（照抄 build-deb.yml）
  - mac-dmg ❌ **新坑 26**：DMG 构建成功后 electron-builder 隐式发布要求 GH_TOKEN
    → 打包命令追加 `--publish never`
  - win-nsis ✅（win 段 package.json 已有 `publish: null`）
- 第 3 轮（run 38034503379）：**三 job 全绿**

### 9.3 验收核对

| 检查项 | 结果 |
|---|---|
| linux-deb job | ✅ 绿 + 产物 290MB（dpkg 装卸与麒麟冒烟待真机） |
| mac-dmg job | ✅ 绿 + 产物 302MB（未签名右键打开 + 冒烟待真机） |
| win-nsis job | ✅ 绿 + 产物 342MB（安装冒烟待真机） |
| 无回归 | ✅ Release `latest` 仅含 main 构建的 DEB，演练零污染 |
| 门禁 | ✅ verify:platform-contract（21 项能力契约）通过 |

### 9.4 win 供应物重排说明

`TMSDK_Windows_3.43.112.5` 包内为 `SDK/x64/{include,*.lib,*.dll,Release/}`，
重排为仓库吻合结构后打包（zip 根 = include/ lib/ x64/，与 workflow 的
`Expand-Archive -DestinationPath wemeet_sdk\win` 对齐）：
`include/` ← SDK/x64/include；`lib/x64/release/wemeetsdk_x64.lib` ← SDK/x64/wemeetsdk_x64.lib；
`x64/` ← SDK/x64 其余运行时（剔除 include、.lib、demo exe、bat）。
头文件与上游仓库逐字节一致（仅换行符差异），编译兼容性已确认。

### 9.5 后续（非本轮）

- [ ] 三端产物真机冒烟（download Artifacts 后人工执行）
- [ ] T7 版本对齐（上游 7bde5ce，SDK 3.45.100）
- [ ] T8 阶段 4 正式 PR（owner 放行后）

---

## 附：完成定义（DoD，本轮范围）

- [x] rehearse 分支推送，build-all.yml 三 job 可触发（T1-T2）
- [x] 供应物按第三节就位（T3，4 项齐备）
- [x] linux / mac / win 产物齐备（T4-T5，win 完整出包无需降级）；真机冒烟待人工
- [x] 演练结论回写本文档第九节 + PITFALLS 坑 26（T6）
- [ ] T7/T8 为延后项，不在本轮 DoD 内
