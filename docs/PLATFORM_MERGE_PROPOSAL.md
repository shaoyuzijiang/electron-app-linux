# Mac/Windows 平台差异评估与合并架构建议

> 背景：Linux 版已落地"统一入口 + 平台分派 + 能力契约"架构（参考 `main.js`）。
> 本文评估 mac/win 两端代码的现有差异，论证把平台差异抽离到独立文件夹、
> 共性代码保持统一的可行方案与迁移路径。

## 一、现状差异量化（基于当前代码实测）

| 文件 | 行数 | 平台分支数 | 分支内容 |
|---|---|---|---|
| main-darwin-win32.js | 481 | 2 | 启动参数、路径处理 |
| ipc-handlers.js | 1954 | 7 | 2 处 switch(process.platform)（SDK 加载选择）、系统信息拼接 |
| sdk_mgmt/wemeet-sdk.js | 573 | 6 | .node 加载路径、SDK DLL 目录、Windows 控制台 UTF-8 |
| bootstrap/start.js | - | 2 | mac Framework 拷贝、win 控制台编码 |
| bootstrap/build.js、after-pack.js | - | 1 | mac 打包钩子 |

**结论：mac 与 win 的差异面很小。** 两者使用同一个 3.43 SDK、同一套 IPC 语义、
同一套渲染层，差异集中在"文件路径 + 加载方式 + 打包钩子"三类机械性分支，
没有逻辑性分歧。全仓平台分支总计约 18 处，其中真正影响行为的不到 10 处。

## 二、目标架构（沿用 Linux 版已验证的模式）

- main.js：分派入口，linux 交给 platform/linux-arm64/main.js（已落地）
- main-darwin-win32.js：mac/win 共享主进程（保持现状，内部分支已很少）
- ipc-handlers.js：共享 IPC（1954 行中仅 7 处平台分支）
- sdk_mgmt/wemeet-sdk.js：共享 SDK 生命周期
- platform/darwin/：建议新增，mac 平台差异收敛点（platform.js）
- platform/win32/：建议新增，win 平台差异收敛点（platform.js）
- platform/darwin-win32/：mac/win 共享能力（现 capabilities 所在处）

Linux 版的核心经验是三件事：

1. adapter 隔离原生细节：渲染层只认通道名，不认 SDK 差异
2. 能力契约替代平台 if：getSdkCapabilities 决定 UI 显隐
3. 分派入口：main.js 只做"我是谁"判断，然后交给平台主进程

mac/win 合并到该模式后，三端结构完全对称。

## 三、迁移方案（分两阶段，风险递增）

### 阶段一：配置级抽离（低风险，建议先行）

不改行为，只把散落的平台分支收敛为"平台配置对象"：

- platform/darwin/platform.js：sdkNodePath（output/mac 下的 .node）、
  sdkRuntimeDir（null，mac 无需 DLL 目录）、consoleSetup（空实现）
- platform/win32/platform.js：sdkNodePath（wemeet_sdk/win/x64 下的 .node）、
  sdkRuntimeDir（wemeet_sdk/win/x64 资源目录）、consoleSetup（chcp 65001）

收敛效果：

- sdk_mgmt/wemeet-sdk.js 的 6 处分支 → 读配置，1 处 switch
- ipc-handlers.js 的 7 处分支 → 同上
- main-darwin-win32.js 的 2 处分支 → 同上
- 回归方式：npm run dist:mac:arm64 / dist:win:x64 出包冒烟（CI 可自动）

### 阶段二：adapter 级统一（等触发条件出现再做）

把 mac/win 的 SDK 生命周期也迁入 platform/<plat>/sdk-adapter.js，
接口形状与 Linux adapter 对齐（ensureLoggedIn/joinMeeting/openView 等）。

触发条件（满足其一再做）：

1. mac/win SDK 升级后行为出现分歧，需要各自适配层
2. 需要三端共用一套 IPC 白名单/安全校验（安全审计要求）
3. 会中选人、录音笔等 SDK 原生窗口功能需要按端定制

不建议现在就做：mac/win 当前共享 3.43 SDK 语义、行为一致，
强行统一 adapter 是纯重构，收益只有"结构美"，风险却是真实的回归成本。

## 四、合并进 electron-app 仓库的注意事项

1. 历史同源：Linux 分支基于 electron-app 的 a773ff8 加后续 3 个提交，
   合并是标准 PR/merge，非跨仓库拼接。
2. 共享文件改动需要 owner 认可：main.js 分派、preload.js、renderer（能力降级）、
   package.json（Electron 统一 33.4.11）、token-store.js、backend_api/api.js。
   行为对 mac/win 保持，但需回归。
3. CI 兜底：合并 PR 上同时跑三端构建（mac dmg / win nsis / linux deb），
   任何一端红即挡合并。
4. Electron 版本统一为 33.4.11：mac/win 从"各版本漂移"变为精确锁定，
   node-gyp --target 与之一致（package.json 已固定）。
5. 供应物 Release：vendor-supplies 需在 electron-app 重建
   （SDK 归档 + 两个架构的 Electron zip）。

## 五、验证清单（合并 PR 的门禁）

- [ ] npm run verify（Linux 全量门禁）
- [ ] CI：linux deb 构建成功 + check --deb 通过
- [ ] CI：mac dmg 构建成功（先 SKIP_SIGN，正式签名后续配 Secrets）
- [ ] CI：win nsis 构建成功
- [ ] mac 真机：登录/预定（SDK 原生窗口）/入会/IM/日程/通讯录冒烟
- [ ] win 真机：同上 + wemeetsdk:// 唤起
- [ ] linux 真机：按 docs/LINUX_TEST_PLAN.md 全量
