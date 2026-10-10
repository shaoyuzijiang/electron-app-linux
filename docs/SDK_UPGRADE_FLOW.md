# SDK 升级流程调研（三端现状与自动化可行性）

> 回答两个问题：SDK 升级现在是怎么做的？能否"自动跟随 SDK 版本更新"？

## 一、三端现状机制

### macOS（脚本化程度最高）

入口：`update-mac-sdk.sh`（292 行，位于 electron-app 仓库）。

前置：人工从腾讯渠道获取 SDK 分发包（含 `metadata.json`、`SDK/TMSDK.framework`、
`tmsdk-node-addon/src/wemeet.cpp`），解压到项目根目录。

脚本自动完成：

1. 读取 `metadata.json` 校验新版本号，与当前版本对比
2. 替换 C++ 封装层 `wemeet_sdk/wemeet.cpp`（+jsoncpp）
3. 替换 `wemeet_sdk/mac/Frameworks/{arm64,x86_64}/TMSDK.framework`
4. 更新 package.json / package-lock.json 版本号
5. 清理 Electron.app 旧 framework 与编译缓存
6. 双架构（arm64 + x64）重新编译原生模块
7. 校验 Framework 版本一致性

### Windows（手动为主）

1. 修改 `wemeet_sdk/win/x64/copy.bat` 的 `SDK_SRC` 指向新分发包后执行
   （拷贝核心 DLL、Release 目录、.lib、.node）
2. 手动复制 `include/*.h` 头文件
3. 替换 `wemeet.cpp` / `jsoncpp.cpp` 封装
4. `npm run build:native:win-x64` 重编
5. 注意清理旧版残留 DLL（新旧 Qt 版本混用会冲突）

### Linux（本仓库，供应物 + 一键构建）

1. 替换 `vendor/TMSDK_*_arm64_default.publish.tar.gz`（同步更新供应物 Release）
2. `npm run setup:kylin`（prepare-sdk → build-native 自动完成其余步骤）
3. 回传 `output/linux/wemeet_electron_sdk.node` 更新 `packaging/prebuilt/`
4. push → CI 自动出包

## 二、能否自动跟随 SDK 版本更新？

**结论：不能全自动，当前"半自动"已是上限。**

核心约束：SDK 分发包通过腾讯商务/技术渠道人工分发，
**没有公开下载源、没有可查询的版本接口**。自动化的前提（感知新版本）不存在。

- "感知新版本"：只能人工获知（商务通知/群公告）
- "拿到包之后"：三端都已脚本化/半脚本化，人工动作只剩"解压到指定位置 + 跑一条命令"

## 三、可行的增强方向（按性价比排序）

1. **统一 metadata.json 机制到三端**（win/linux 目前靠文件名/人工记忆版本），
   升级脚本可校验"包版本与 package.json 声明一致"，防止错包
2. **升级 checklist 脚本化**：把 Windows 的手动 5 步合成 `update-win-sdk.sh`
   （对标 mac），降低人为遗漏（旧 DLL 清理尤其容易踩坑）
3. **若未来 SDK 有正式下载源/版本 API**：增加 scheduled workflow，
   定时比对版本 → 自动开升级 PR（替换供应物 + 触发三端构建）
4. **多 SDK 版本并存**：vendor 按 SDK 版本分目录存放，支持灰度验证新版本

## 四、版本一致性红线

无论哪端升级，以下三项必须同步，否则出现 ABI/行为错位：

- package.json 的 electron 精确版本（node-gyp --target 必须一致）
- 原生 addon 必须重新编译（不允许复用旧 .node）
- renderer/能力契约按新 SDK 接口面复核（用 strings 审计编译产物，
  参考 docs/PITFALLS.md 坑 10/11）
