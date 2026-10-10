# 合并 electron-app 演练方案（先自测，后操作）

> 目标：在【自己的仓库 electron-app-linux】里完整演练"合并进 electron-app"的全过程，
> 包括三端自动构建验证。演练全部通过后，把同一套东西推到 electron-app 开 PR，
> 届时只是"换个仓库地址重复一遍"，风险已在自己仓库消化完毕。

---

## 一、先回答 main.js 结构问题："像截图那样在 main.js 里写平台分支可不可以？"

截图里 electron-app 的 main.js 用**同文件内平台分支**处理差异：
- macOS：`app.on('open-url')` 承接 scheme 唤起
- Windows：`requestSingleInstanceLock` 单实例锁 + `second-instance` 承接

**这种模式对"参数级/几十行级"差异：完全可以用，而且我们已经在用。**
截图那段 scheme 代码被原样保留在 `main-darwin-win32.js`（326-363 行），
mac/win 之间的此类小差异继续用 if 分支，不需要抽文件。

**但 Linux 不能用这种模式，原因是"架构级"差异而非"参数级"差异：**

| 维度 | mac/win（3.43 SDK） | Linux（3.26 SDK） |
|---|---|---|
| 进程模型 | 渲染层直接调原生 SDK | 安全隔离：渲染层只认 IPC 通道，adapter 内部持有 addon |
| IPC | 132 通道直连 | 白名单 81 通道 + 后端通道 + 能力契约裁剪 |
| 窗口管理 | SDK 原生窗口由 Electron 管理 | SDK 独立进程（tmsdkapp/QtWebEngine） |
| 代码量 | — | Linux 主进程全套约千行，独立演进 |

如果把这套东西用 if/else 内联进 481 行的单文件，
等于把 Linux 的安全隔离边界搅进 mac/win 的主进程——
任何一端改动都会影响另一端，回滚也只能整体回滚。

**当前形态（推荐保持）：**

```js
// main.js（8 行，完整内容）
'use strict';
if (process.platform === 'linux' && process.arch === 'arm64') {
  require('./platform/linux-arm64/main').start();
} else {
  require('./main-darwin-win32');
}
```

它就是"截图模式"的文件级等价物：分派逻辑本身只有 8 行
（比截图里一组 if 还短），差异实现各归各位。
mac/win 内部的参数级差异（scheme 等）继续在 main-darwin-win32.js 内用 if 处理。

---

## 二、演练方案总览

```
阶段 0  准备供应物（一次性，决定 mac/win CI 能否跑完整打包）
阶段 1  在 electron-app-linux 开演练分支 rehearse/electron-app-merge
阶段 2  添加三端 CI workflow（linux deb + mac dmg + win nsis）
阶段 3  三端构建全绿 → 演练通过
阶段 4  把同一分支/工作流推到 electron-app 开 PR → 三端再绿 → 请求合并
回退    任意阶段失败：删演练分支即可，自己仓库 main 与 electron-app 均不受影响
```

**为什么这个演练有价值**：合并进 electron-app 后 CI 要跑的
就是"同一份代码出三端包"，现在在自己仓库把三端构建跑绿，
等于把合并后最大的不确定性（mac/win 是否被改坏）提前验证掉。

---

## 三、阶段详解

### 阶段 0：供应物准备

三端构建各自需要的"平台私有原料"（不入库，放 Release `vendor-supplies`）：

| 端 | 已有 | 还需补充 |
|---|---|---|
| linux arm64 | SDK 3.26 归档、Electron arm64 zip | 无（已开通） |
| mac arm64 | — | `TMSDK.framework`（arm64，来自 wemeet_sdk/mac/Frameworks/） |
| win x64 | — | Windows SDK 运行时目录（wemeet_sdk/win/x64 全套） |

**降级选项（若暂不想上传大供应物）**：mac/win 先跑"轻验证"——
只验证原生 addon 能在 CI 编译（node-gyp 对 33.4.11）+ electron-builder
`--dir` 出目录包（跳过 Framework 拷贝的完整 dmg/nsis），
足以证明"合并没改坏 mac/win 的构建链"；完整打包等供应物补齐后启用。

### 阶段 1：演练分支

```bash
git checkout -b rehearse/electron-app-merge main
git push origin rehearse/electron-app-merge
```

### 阶段 2：三端 CI（工作流要点）

新增/改造 `.github/workflows/build-all.yml`：

```text
矩阵：
  job linux-deb   ：现有流程（已绿，不动）
  job mac-dmg     ：macos-14 runner
                     npm ci（下载 darwin electron）
                     node-gyp 编译 arm64 addon（target=33.4.11）
                     electron-builder dmg（SKIP_SIGN=1）
                     ※ 需 TMSDK.framework：从 vendor-supplies 补充下载
  job win-nsis    ：windows-2022 runner
                     npm ci
                     node-gyp 编译 x64 addon
                     electron-builder nsis
                     ※ 需 win SDK runtime：同上补充下载
触发：push 到 main / rehearse/electron-app-merge + 手动
```

要点：
- mac/win 的 addon 在 runner 上现场编译（mac/win 无 glibc 基线问题，可编译）
- 产物都挂 Actions Artifacts，不覆盖 Release latest（那个只属于 linux 正式包）
- `permissions: contents: read`（演练阶段不需要发布权限）

### 阶段 3：验收标准

- [ ] 三个 job 全绿
- [ ] linux deb：`check --deb` 通过、可安装启动
- [ ] mac dmg：能打开、登录/入会/预定冒烟（未签名需右键打开）
- [ ] win nsis：能安装、同上冒烟

### 阶段 4：正式操作 electron-app

1. 与 owner 对齐：共享文件改动清单（18 个 M 文件，见
   `docs/PLATFORM_MERGE_PROPOSAL.md` 第一节）+ mac/win 回归由 CI 兜底
2. `git push` 演练分支到 electron-app → 开 PR
   （PR diff = 73 个文件，即已量化过的全部改动）
3. PR 描述直接引用 `docs/PLATFORM_MERGE_PROPOSAL.md` 与本演练的绿色结果
4. owner review → 合并 → electron-app 的 CI（同款 workflow）接管自动打包

---

## 四、回退机制

| 阶段 | 回退动作 | 影响面 |
|---|---|---|
| 演练分支构建失败 | 删除演练分支 | 零影响（main 未动） |
| 演练通过但决定暂缓 | 分支保留不动 | 零影响 |
| electron-app PR 阶段出问题 | 关闭 PR / 删除远端分支 | electron-app main 未动 |
| PR 已合并后发现回归 | git revert PR merge commit | 仅回退相关提交 |

所有阶段的回退都是"删分支/关 PR"级别，main 永远不被强推。

---

## 五、角色与前置确认

| 事项 | 谁 |
|---|---|
| electron-app owner 同意"共享文件改动 + CI 三端兜底"方案 | 你 ↔ owner |
| mac/win 供应物（Framework / win runtime）上传 vendor-supplies | 你（或给我 gh 权限代传） |
| 演练分支与工作流落地 | 我 |
| 三端真机冒烟 | 你（mac/win 机器） |
