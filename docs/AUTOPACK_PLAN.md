# 自动化打包方案（push → 自动出 DEB）

> 目标：代码推上 GitHub 后自动产出 Linux ARM64 `.deb` 安装包，
> 下载后直接发布到下载页给客户安装，全程不需要麒麟机器参与。

## 原理

DEB 的四类组成与来源：

| 组成 | 来源 | 是否需要编译 |
|---|---|---|
| 应用源码（main/renderer/backend_api 等） | 仓库本体现做 | 否 |
| Electron 33.4.11 runtime | GitHub Release 附件（一次性上传） | 否 |
| SDK 3.26 私有库 | GitHub Release 附件（一次性上传） | 否 |
| 原生 addon（.node） | `packaging/prebuilt/wemeet_electron_sdk.arm64.node`（已入库，麒麟编译） | 否 |

GitHub Actions 的 ubuntu 云端机器自带 `dpkg-deb`，x64 机器组装 arm64 包
只是数据打包，不涉及编译。因此 push → 出 DEB 完全可行。

## 一次性开通步骤（约 10 分钟）

1. **上传供应物**（在本地仓库目录执行，需要 gh CLI 或网页上传）：

   ```bash
   # 用 gh CLI：
   gh release create vendor-supplies \
     vendor/TMSDK_0300000000_3.26.100.14_arm64_default.publish.tar.gz \
     vendor/electron-v33.4.11-linux-arm64.zip \
     --title "离线构建供应物" --notes "SDK 3.26.100.14 + Electron 33.4.11，CI 构建用，请勿删除"
   ```

   没装 gh CLI 也可以：GitHub 仓库页 → Releases → Draft a new release →
   tag 填 `vendor-supplies` → 把上面两个文件拖进附件 → Publish。

2. **激活工作流**：工作流文件已在仓库
   `.github/workflows/build-deb.yml`，合并进 main 后，
   push 或手动 Actions → build-linux-deb → Run workflow 即触发。

3. **取包**：main 分支的每次构建会自动把最新 `.deb` 发布到 Release
   `latest`，命名与 Mac/Windows 下载页同构：
   `tencent-meeting-sdk-demo-<版本>-<构建日期>-arm64.deb`
   （每次发布自动清理旧日期资产，Release 内始终只有最新一个）。

   > GitHub 资产名不允许中文/空格（会被强制清洗），因此仓库侧用全 ASCII 名。
   > 上传到自有下载页时，展示名按 mac/win 规范命名为
   > 「腾讯会议SDK Demo-<版本>-<日期>-arm64.deb」即可，与截图对齐。

   命令行拉取最新版：

   ```
   gh release download latest -R shaoyuzijiang/electron-app-linux
   ```

   历史构建也可在各次 Actions 运行页下载 `linux-arm64-deb` 产物（保留 90 天）。

## 关于"新开一个仓库"

当前方案是**同仓库工作流**（push 源码仓库即构建），推荐维持这样——
源码和打包定义在一起，改代码和出包天然同步。

如果将来要把"打包发布"独立出去（例如源码仓库私有、发布仓库公开），
迁移方法很简单：

1. 新仓库放同样的 `.github/workflows/build-deb.yml`
2. 供应物 Release 传到新仓库
3. 工作流里加一步 `actions/checkout` 拉取源码仓库（用 token）
4. 其余步骤完全不变

## .node 什么时候需要重新编译

`packaging/prebuilt/wemeet_electron_sdk.arm64.node` 只在以下情况过期：

- Linux SDK 版本升级（换 vendor 里的 SDK 归档时）
- Electron 大版本升级（改 package.json 的 electron 版本时）
- 修改 `native/linux/*.cpp` 或 `binding.gyp`

此时需要一次麒麟流程（用旧传输包或当时的仓库快照）：

```bash
# 麒麟上：
npm run setup:kylin
tar -czf ~/addon-linux-arm64.tar.gz -C output/linux wemeet_electron_sdk.node
# 带回后更新 packaging/prebuilt/wemeet_electron_sdk.arm64.node 并提交
```

日常业务开发（页面/IPC/后端/样式）**不触及 .node**，无需麒麟。

## 版本管理约定

| 内容 | 位置 | 更新时机 |
|---|---|---|
| 预编译 addon | `packaging/prebuilt/`（入库） | SDK/Electron/原生源码变化时 |
| SDK 归档 | vendor/（不入库）+ Release 附件 | SDK 升级时 |
| Electron zip | vendor/（不入库）+ Release 附件 | Electron 升级时 |
| 工作流 | `.github/workflows/build-deb.yml` | 打包结构变化时 |

## 与麒麟离线链路的关系

`vendor/ + package:transfer:linux` 传输包链路**保留**，仅用于
"SDK/Electron 升级后在麒麟重编 addon"这一种场景。
日常发版全部走 CI。
