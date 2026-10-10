# 合并 electron-app 演练方案（施工图 · 可独立执行版 v2）

> **执行者须知**：本文档面向"没有参与过前期开发"的执行者（人或 AI），
> 所有命令、YAML、路径均可直接复制执行。仓库为 shaoyuzijiang/electron-app-linux，
> 工作分支 main。执行期间**不接触、不修改 electron-app 仓库**——
> 那是最后阶段（阶段 4）才做的事，且需 owner 放行。
>
> 遇到报错先查 `docs/PITFALLS.md`（25 个已踩坑）与本文件"注意事项汇总"。

## 〇、项目背景速览

| 项 | 内容 |
|---|---|
| 产品 | 腾讯会议 SDK Electron 桌面客户端（原生 .node 插件 + 自研后端 HTTP API 负责账号/IM/日程/通讯录） |
| 本仓库 | shaoyuzijiang/electron-app-linux —— Linux ARM64（银河麒麟 V10）完整版 + 三端统一架构 |
| 上游仓库 | carlliu67/electron-app —— Mac/Windows 版（Electron + 3.43 SDK） |
| 关键事实 | 上游 main（6c881fd）= 本仓库分叉点，**上游分叉后零提交** → 合并零冲突 |
| Electron | 三端统一 33.4.11（精确锁定，node-gyp --target 必须一致） |
| 自动化现状 | push main → GitHub Actions 自动出 Linux ARM64 DEB → 自动发布 Release `latest` |

### 目录职责

| 路径 | 职责 |
|---|---|
| main.js | 平台分派入口（8 行）：linux-arm64 → platform 主进程；否则 → main-darwin-win32 |
| main-darwin-win32.js | mac/win 主进程：窗口、scheme 唤起（open-url / 单实例锁）、IPC、SDK 生命周期 |
| ipc-handlers.js | 约 100 个 ipcMain.handle 通道，桥接渲染进程与 backend_api、wemeet_sdk |
| bootstrap/preload.js | contextBridge 暴露 132 个通道（渲染层唯一入口） |
| backend_api/ | 通用 HTTP（RSA+AES）、auth 登录、api.js re-export im/meeting/calendar |
| sdk_mgmt/wemeet-sdk.js | mac/win 原生 SDK 装载、Token 管理、SDK 审计、回调桥 |
| renderer/ | 三端共享 UI（login/index/user-picker + js/css） |
| utils/ | token 存储、日志、账号存储（safeStorage）、webview 管理 |
| platform/linux-arm64/ | Linux 主进程 + SDK 3.26 adapter + 安全 IPC + 后端通道 + 图形环境 |
| common/contracts/ | 跨平台能力契约（21 项，UI 显隐唯一依据） |
| native/linux/ | Linux SDK C++ N-API 封装源码（在麒麟编译为 .node） |
| packaging/ | DEB 资源 + 预编译 addon + 图形环境脚本 |
| scripts/ | 构建/检测/打包脚本（check.sh 为统一检测入口） |

### main.js 结构结论（已评审，不要改动）

- mac/win 之间的"参数级"差异（如 scheme 的 open-url vs 单实例锁）：
  同文件内 if 分支，保留在 main-darwin-win32.js（326-363 行），不需要抽文件。
- Linux 属"架构级"差异（安全隔离 adapter 模型）：必须文件级分派，
  即当前 8 行 main.js。维持现状。

## 一、供应物准备（阶段 0）

三端 CI 需要的平台私有原料，统一放在 GitHub Release tag `vendor-supplies`。
当前已有 2 个资产，还需补 2-3 个。

### 1.1 现有资产（勿动）

| 资产 | 用途 |
|---|---|
| `TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz`（277MB） | Linux arm64 SDK |
| `electron-v33.4.11-linux-arm64.zip`（106MB） | Linux arm64 Electron |

### 1.2 需补充的资产

| 资产名（建议） | 来源（本机实测路径） | 用途 |
|---|---|---|
| `TMSDK.framework.arm64.zip` | `/Users/yangzijian/SDKDev/electron-app/wemeet_sdk/mac/Frameworks/arm64/TMSDK.framework`（408MB，实测存在） | mac CI：编译期 Headers + 打包期 Framework |
| `TMSDK.framework.x86_64.zip`（可选） | mac SDK 分发包 `TMSDK_MacOS_3.43.112.62_*.zip` 内（`SDK包/` 目录已确认存在） | mac x64 构建备用 |
| `wemeet-sdk-win-x64-runtime.zip` | **本机未定位到**（electron-app 工作目录的 wemeet_sdk/win 仅 36K 源码/脚本，DLL 不在其中）。需从 Windows SDK 分发包或 win 打包机收集 | win CI：编译 + 运行 |

**win runtime zip 的内部结构要求**（解压后必须与仓库路径吻合）：

```
wemeet_sdk/win/
├── include/            # SDK C++ 头文件（编译需要）
├── lib/x64/release/wemeetsdk_x64.lib   # 链接库（编译需要）
└── x64/                # 运行时（打包需要）
    ├── wemeet_electron_sdk.node
    ├── wemeetsdk_x64.dll、wemeet_base.dll 等
    └── Release/        # SDK 业务 DLL、modules、plugins、resources
```

**打包与上传命令**（mac Framework 为例）：

```bash
cd /Users/yangzijian/SDKDev/electron-app/wemeet_sdk/mac/Frameworks/arm64
zip -qry /tmp/TMSDK.framework.arm64.zip TMSDK.framework
gh release upload vendor-supplies /tmp/TMSDK.framework.arm64.zip --clobber \
  -R shaoyuzijiang/electron-app-linux
```

**降级方案**：win 运行时暂缺时，win job 先只做"addon 编译验证"
（node-gyp 成功即证明 ABI/工具链 OK），nsis 完整打包等运行时到位后启用。

### 1.3 供应物红线

- tag `vendor-supplies` 的资产是 CI 构建原料，**删除任何一项都会打断自动构建**。
- tag `latest` 是对客户分发的最新 DEB（每次 main 构建自动覆盖），与供应物互不干扰。
- 命名规范：构建产物统一为 `腾讯会议SDK Demo-<版本>-<日期>-arm64.deb`；
  GitHub Release 资产因平台限制用 ASCII 名
  `tencent-meeting-sdk-demo-<版本>-<日期>-arm64.deb`（中文会被强制清洗）。

---

## 二、演练分支（阶段 1）

```bash
cd /Users/yangzijian/SDKDev/electron-app-linux
git checkout main && git pull origin main
git checkout -b rehearse/electron-app-merge
git push -u origin rehearse/electron-app-merge
```

该分支 = main 的完整拷贝。所有演练改动在此分支进行；
build-all.yml 的触发条件包含此分支（见下文 YAML）。

---

## 三、三端 CI 工作流（阶段 2 · 核心交付物）

新建文件 `.github/workflows/build-all.yml`，内容为下方全文（直接复制）。

设计说明：

- linux job：main 分支由现有 build-linux-deb.yml 负责正式构建+发布；
  演练分支/手动触发时由本 workflow 兜底构建（不发布）。
- mac job：runner（macos-14，arm64）现场用 node-gyp 编译 addon
  （mac 无 glibc 基线问题），electron-builder 打 dmg，SKIP_SIGN=1 跳过签名。
- win job：runner（windows-2022，自带 VS2022 + Python）编译 addon，
  electron-builder 打 nsis（无签名配置，天然可构建）。
- 演练阶段产物全部挂 Actions Artifacts，不碰 Release。

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

### 本 workflow 专属注意点（执行时易踩）

1. mac/win 的 npm ci --ignore-scripts 不写 electron 包的 path.txt，
   若任何步骤 require('electron') 报 "Electron failed to install correctly"，
   参照 build-linux-deb.yml 的"补齐 electron 包元数据"步骤
   （printf 'electron' > path.txt 并 mkdir dist）。
   electron-builder 打包会自行下载对应平台 Electron，不受影响。
2. win job 解压用 PowerShell 的 Expand-Archive（Git Bash 无 unzip 命令）。
3. mac job 编译期 include_dirs 固定指向 x86_64 Framework 路径（头文件与架构无关），
   因此必须创建 x86_64 软链接指向 arm64 Framework（YAML 已含该步骤）。
4. mac job 的 build:native:mac-arm64 会从 electronjs.org 下载 33.4.11 headers，
   runner 外网可达，无需额外配置。
5. 若 win 运行时供应物暂缺，win job 先整体注释或加 if: false，
   仅跑 mac + linux 演练（降级方案见 1.2）。

---

## 四、阶段 3：演练验收标准

执行方式：推送演练分支后，在 Actions 页手动 Run workflow（或 push 自动触发）。

| 检查项 | 通过标准 |
|---|---|
| linux-deb job | 绿 + linux-arm64-deb 产物存在；deb 下载后 dpkg -i 可装可卸 |
| mac-dmg job | 绿 + mac-arm64-dmg 产物存在；dmg 拷到 mac 可打开（未签名右键打开），登录/入会/预定冒烟 |
| win-nsis job | 绿 + win-x64-nsis 产物存在；exe 安装后登录/入会冒烟 |
| 无回归 | Release latest 未被演练构建覆盖（发布步骤只在 main 生效） |

失败排查优先查 docs/PITFALLS.md 对应条目（CI 类坑 18/22/25，环境类坑 1-5）。

## 五、回退机制

| 场景 | 动作 | 影响 |
|---|---|---|
| 演练构建失败 | 修分支 / 删分支（git push origin --delete rehearse/electron-app-merge） | 零影响，main 未动 |
| 演练通过但决定暂缓 | 分支保留不动 | 零影响 |
| electron-app PR 阶段出问题 | 关 PR / 删远端分支 | 上游 main 未动 |
| PR 已合并后发现回归 | revert 合并提交 | 仅回退相关提交 |

## 六、阶段 4：正式操作 electron-app（owner 放行后）

前置确认（见 docs/PLATFORM_MERGE_PROPOSAL.md 第四节）：

- owner 认可 18 个共享文件改动 + "CI 三端兜底"的回归方案
- electron-app 重建 vendor-supplies（Linux 供应物 + mac Framework + win runtime）

操作序列：

1. 推演练分支到 electron-app（owner 已给写权限时）：
   git remote add electron-app https://github.com/carlliu67/electron-app.git
   git push electron-app rehearse/electron-app-merge:feat/linux-arm64
2. electron-app 上开 PR：feat/linux-arm64 → main
   PR 描述引用 docs/PLATFORM_MERGE_PROPOSAL.md + 本演练绿色结果
3. PR CI 三端全绿 → owner merge
4. 合并后：vendor-supplies 供应物迁移到 electron-app 的 Release
   （build-all.yml / build-linux-deb.yml 一并合入，自动接管打包）

## 七、附加交付一：平台差异评估（任务 3）

详见 docs/PLATFORM_MERGE_PROPOSAL.md。要点：

- mac/win 全仓平台分支约 18 处（真正影响行为的不到 10 处），
  集中在文件路径、加载方式、打包钩子三类机械性分支
- 建议两阶段：阶段一配置级抽离（低风险，CI 可自动回归）；
  阶段二 adapter 级统一（等 mac/win SDK 分歧或安全审计需求出现再做）
- 不建议现在对 mac/win 做纯重构

## 八、附加交付二：SDK 升级机制调研（任务 4）

详见 docs/SDK_UPGRADE_FLOW.md。要点：

- mac：update-mac-sdk.sh 高度自动化（metadata 校验→替换→升版本→双架构重编）
- win：手动 5 步（建议脚本化对标 mac）
- linux：vendor 换归档 + setup:kylin + addon 回传
- SDK 包走人工渠道、无公开版本源 → 全自动跟随不可行，
  "拿到包之后"已全部脚本化；含版本一致性红线清单

## 九、注意事项汇总（跨阶段 · 全量）

### 仓库与安全红线

- N1 全程普通用户操作（麒麟侧），禁止 sudo npm、禁止 --no-sandbox
- N2 vendor-supplies 与 latest 两个 Release 职责分离，互不覆盖
- N3 凭据/Token/密钥类文件绝不入库、绝不进产物（CI 与打包脚本均有检查）
- N4 不调用 ldd 探测 SDK 私有库（触发麒麟安全弹窗），用 readelf 静态解析

### 构建与环境

- N5 Linux addon 必须在 glibc 2.31 基线（麒麟）编译；日常用预编译产物，CI 只组装
- N6 Electron 三端精确锁定 33.4.11，node-gyp --target 必须一致
- N7 kysec 可能拦截 python3 -c，build-native.sh 已内置 wrapper 自动切换
- N8 mac 编译期 include_dirs 固定走 x86_64 头文件路径（头文件与架构无关），
  arm64 构建也要保证该路径存在

### CI 与发布

- N9 npm ci --ignore-scripts 不写 electron 包元数据，CI 需手动补
  （path.txt + dist/），否则任何 require('electron') 会抛错
- N10 Actions Artifacts 自动压缩成 zip；对外分发一律用 Release 资产
- N11 GitHub 资产名禁止中文/空格（强制清洗：中文删除、空格变点）
- N12 资产名以 - 开头时，gh release delete-asset 按名删除会误判为选项，
  一律按资产 id 删除（workflow 已按此实现）
- N13 工作流 YAML 的 run 块内续行必须缩进，改完先本地
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/xxx.yml'))" 验证
- N14 预定会议走服务端一体化创建（createMeeting: true），禁止恢复
  前端二次日程同步（validate-linux-parity 已加反向防护）

### 文档与版本

- N15 版本一致性红线：package.json electron 版本、node-gyp --target、
  预编译 addon 三者必须同步更新（见 docs/SDK_UPGRADE_FLOW.md）
- N16 传输包（401MB）是构建工具箱、DEB（~277MB）是客户安装包，勿混用
- N17 新问题必须回写 docs/PITFALLS.md（症状→原因→解决），保持文档自愈

## 附：完成定义（DoD）

- [ ] vendor-supplies 补齐 mac Framework（win runtime 可后补，win job 先降级）
- [ ] rehearse 分支推送，build-all.yml 三 job 触发
- [ ] linux / mac / win 产物齐备且真机冒烟通过
- [ ] 演练结论记录回本文档（追加"演练结果"小节）
- [ ] owner 放行后，按阶段 4 执行 electron-app PR
