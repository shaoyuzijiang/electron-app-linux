# 踩坑记录（问题 → 原因 → 解决）

本文档记录 Linux（银河麒麟 ARM64）版本开发过程中实际遇到并已解决的问题，
供后续维护者快速定位同类症状。按"构建环境 / 图形显示 / SDK 与功能 / 仓库与 CI"分类。

---

## 一、构建环境类

### 1. addon 在麒麟上加载失败：`GLIBC_2.32 not found`

- **症状**：应用启动即崩，日志提示 GLIBC 版本找不到。
- **原因**：原生 addon（.node）是链接了 glibc 的机器码。在 Ubuntu 等新系统（glibc ≥2.35）上编译的产物，拿到 glibc 2.31 的麒麟 V10 上必然加载失败。**这是二进制兼容的物理限制，不是代码问题。**
- **解决**：addon 必须在 glibc 2.31 基线机（麒麟 V10 SP1）上编译。`scripts/build-native.sh` 已内置基线强校验。日常发版使用仓库中预编译产物 `packaging/prebuilt/wemeet_electron_sdk.arm64.node`，CI 直接组装不编译。
- **何时需要重编**：Linux SDK 升级 / Electron 版本升级 / 修改 `native/linux/*.cpp`。流程见 `docs/AUTOPACK_PLAN.md`。

### 2. 麒麟 kysec 拦截 `python3 -c`，node-gyp 编译失败

- **症状**：编译时报 Python 相关错误，但 `python3 --version` 正常。
- **原因**：麒麟 kysec 安全策略禁止 `python3 -c "code"` 形式执行，而 node-gyp 内部固定用该形式探测解释器。
- **解决**：`scripts/build-native.sh` 检测到 `-c` 被拦后自动切换 `scripts/python-node-gyp-wrapper.sh`（把探测转成临时脚本文件执行），无需管理员干预。

### 3. 使用 root/sudo 运行导致应用无法启动

- **症状**：Chromium sandbox 报错，或界面异常。
- **原因**：`sudo npm` 会让产物归属 root；`--no-sandbox` 关闭沙箱都是错误方向。
- **解决**：全程普通用户操作。`npm run check` 会检测 user namespace 或 chrome-sandbox SUID（4755）是否可用。

### 4. GCC 报不支持 `-std=gnu++2a`

- **原因**：SDK addon 需要 C++20 别名，麒麟默认 GCC 版本可能不带。
- **解决**：由管理员安装麒麟 V10 可用的 C++20 工具链。`npm run check` 会预先检测此项。

### 5. 离线安装丢运行时依赖

- **症状**：DEB 装好后启动报 `Cannot find module 'node-fetch'`。
- **原因**：`node-fetch` 是应用运行时依赖（dependencies），DEB 内要用 `npm ci --omit=dev` 安装；早期漏掉导致启动即崩。
- **解决**：`build-deb.sh` 在包内 staging 目录离线安装生产依赖；vendor npm 离线缓存必须完整（`check.sh` 有检查）。

---

## 二、图形显示类

### 6. 会议窗口黑屏 / SDK 界面无法显示

- **原因**：麒麟 V10 桌面是 Wayland + 厂商私有 GPU 驱动（mali），SDK 的 Qt 界面需要厂商 X11-Wayland 兼容层，且私有库路径必须先于系统库。
- **解决**：启动前 `source /opt/x11-wayland/x11-ext.sh`，并把 SDK 私有库目录前插到 `LD_LIBRARY_PATH`。已封装在 `packaging/graphics-env.sh` + `packaging/launcher.sh`，DEB 与 `npm start` 均自动执行。
- **回退开关**：环境变量 `WEMEET_SYSTEM_X11_WAYLAND=1` 可强制走系统 Mesa 路径。

### 7. 外部 `LD_PRELOAD` 残留导致 SDK 崩溃

- **原因**：继承自桌面会话的 `LD_PRELOAD` 会注入 SDK 进程，与私有库冲突。
- **解决**：launcher 中显式清空 `LD_PRELOAD` 后再按需注入自有库。

### 8. Electron 渲染花屏/闪烁

- **原因**：麒麟 ARM64 上 Electron 硬件加速不稳定。
- **解决**：禁用 GPU 走软件渲染。**会议视频不受影响**——视频由 SDK 独立进程（tmsdkapp）渲染，不经过 Electron 的 GPU 通路。

### 9. 禁止用 `ldd` 探测 SDK 私有库

- **原因**：麒麟安全认证会把 ldd 对 SDK Qt 库的探测识别为"未认证执行"并反复弹窗。
- **解决**：依赖检查统一走 `scripts/resolve-elf-dependencies.sh`（readelf NEEDED 静态解析 + 交付目录 + ldconfig 缓存），不执行任何 SDK/Qt/Electron 二进制。

---

## 三、SDK 与功能类

### 10. SDK 3.26 与 Mac/Win 3.43 的能力差异（重要）

Linux SDK 3.26 的 C++ 接口面比 3.43 小很多，以下接口在源码层被 `#ifndef __linux__` 裁剪或根本不存在：

> 共享屏幕（ShowScreenCastView）、录音笔、录制查看、Rooms 控制器、直播、会中应用、字幕、AI 小助手

- **判断方法**：`strings wemeet_electron_sdk.node | grep -c 接口名`，0 = 被裁剪（**注意：只看源码注册表会被条件编译误导，必须以编译产物为准**）。
- **解决**：这些入口通过能力契约（`platform/linux-arm64/capabilities.js`）整体关闭，共享 UI 自动隐藏，不做半可用状态。
- **防护**：`scripts/validate-linux-parity.js` 静态扫描 adapter，禁止暴露被裁剪接口——曾成功拦截一次误启用（详见第 11 条）。

### 11. 误启用共享屏幕的教训

- **过程**：仅凭源码注册表出现 `ShowScreenCastView` 就判断可用并实现，功能对齐门禁立刻拦截。
- **复核**：二进制 strings 为 0 次、条件编译确认裁剪、门禁注释"真机已证实"。
- **结论**：**能力开关必须以编译产物（真实 .node 二进制）为最终依据**，且信任门禁。

### 12. 入会默认不开视频

- **原因**：SDK 3.26 的 `JoinMeeting` 参数顺序为 `[会议号, 显示名, 密码, 邀请链接, mic_on, camera_on, speaker_on, ...]`，camera_on 是显式参数（下标 5），不传时由 SDK 设置页决定，预期不符。
- **解决**：adapter 显式传 `camera_on=true` 默认开视频，前端可传 `cameraOn=false` 覆盖。有单元测试钉住参数下标。

### 13. 预定会议在日程中出现两条（一条会议、一条日程）

- **原因**：前端预定成功后会把会议同步成日程；同时服务端/SDK 侧也可能为该会议自动生成日程 → 叠加两条。
- **解决**：同步前先拉取日历查重（内嵌会议号一致，或同主题且开始时间一致），已存在则跳过创建。见 `renderer/js/meeting.js` 的 `syncMeetingToCalendar`。
- **注意**：修复只防新数据，历史双条需在日程页手动删除。

### 14. IPC 通道缺失：`No handler registered for 'xxx'`

- **原因**：共享渲染层（与 Mac/Win 同源）会调用全部 132 个通道，Linux 少注册任何一个，用户点到对应功能就报错。退出登录时报 `api.logout is not a function` 也属此类（调用了不存在的后端函数）。
- **解决**：`scripts/validate-linux-parity.js` 把 preload 全量通道与 Linux 注册清单对齐，缺一个都过不了门禁。**新增共享功能时必须同步跑 `npm run verify`**。

### 15. SDK Token 请求未携带凭据

- **原因**：早期 `/api/auth/sdk-token` 匿名可调，存在安全风险且三端语义不一。
- **解决**：统一为必须携带当前登录 Access Token 请求；Linux adapter 与 Mac/Win 同语义。

### 16. Linux Token 落盘的安全隐患

- **原因**：早期 Token 明文写文件，麒麟桌面多数没有安全密钥环。
- **解决**：Linux 版 Token 仅驻留内存，退出即清除；记住密码用 `safeStorage` 加密，密钥环不可用时降级为不保存。

---

## 四、仓库与 CI 类

### 17. push 报 `did not receive expected object xxx`

- **症状**：push 到 GitHub 被拒，且报错对象本地根本不存在。
- **原因**：**本地是浅克隆**（存在 `.git/shallow` 文件），历史不全，服务端校验完整历史时找不到被截断的祖先提交。
- **解决**：`git fetch --unshallow <原始上游仓库>` 补全历史后重推。判断方法：`ls .git/shallow` 存在即是浅克隆。

### 18. CI 门禁测试报 `Electron failed to install correctly`

- **原因**：CI 上 `npm ci --ignore-scripts` 跳过了 electron 包的安装脚本，`require('electron')` 因缺 `path.txt` 抛错。
- **解决**：工作流在安装后手动补 `path.txt` 与 `dist/` 空目录（门禁测试只需要 require 不抛错，不需要真实运行时）。

### 19. Actions 产物下载下来是 zip，不是 deb

- **原因**：GitHub Actions 的 Artifacts 机制强制自动压缩。
- **解决**：分发用 Release 页资产（原始文件），Actions 产物仅作构建记录。工作流已改为构建成功后自动把固定名 `wemeet-demo-linux-arm64.deb` 发布到 Release `latest` 并覆盖更新。

### 20. 供应物 Release 和安装包 Release 不要混用

- **约定**：tag `vendor-supplies` 存 SDK 归档 + Electron zip（CI 构建原料，**勿删**）；tag `latest` 存对客户分发的最新 DEB（每次构建覆盖）。

### 21. 远端仓库对象损坏，任何 push 都被拒

- **症状**：`remote rejected (failed)`，verbose 日志见 `fatal: did not receive expected object`，且该对象本地也不存在。
- **原因**：仓库初次推送曾中断，服务端对象库残缺。
- **解决**：无法原地修复。本地先 `git ls-remote` + `fetch` 把远端所有引用对象抓全，然后删除重建空仓库、重推（本次就是这么做，无数据丢失）。

### 22. 工作流 YAML 被"顶格续行"截断

- **症状**：push 后 CI 0 秒即失败，提示 `workflow file issue`。
- **原因**：`run: |` 块里的多行字符串续行没有缩进，YAML 解析器把后续内容当成了新的顶层键。
- **解决**：块内所有行保持一致缩进；改完先本地 `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-deb.yml'))"` 验证再推。

### 23. Electron 版本漂移导致 addon ABI 不匹配

- **背景**：早期 Linux 包用 Electron 43，Mac/Win 用 33，三端 ABI 各自为政。
- **解决**：三端统一固定 Electron 33.4.11，`node-gyp --target` 必须与之一致；`package.json` 中 electron 版本用精确版本号（不带 `^`）。

### 24. 传输包（401MB）与安装包（277MB）的区别

- **传输包**：给离线麒麟机器的"构建工具箱"（SDK 归档 + Electron zip + npm 缓存 + 源码），只在需要重编 addon 或离线构建时使用。
- **DEB 安装包**：给客户的最终产物（~277MB），由 CI 自动产出。二者不要混为一谈，也不要把传输包传给客户。

---

## 五、快速定位索引

| 症状 | 优先查 |
|------|--------|
| 启动即崩 / GLIBC 报错 | 坑 1（addon 基线） |
| 会议窗口黑屏 | 坑 6、7、8（图形三件套） |
| 反复弹安全认证窗口 | 坑 9（ldd 禁用） |
| 编译报 Python 错误 | 坑 2（kysec） |
| 启动报 Cannot find module | 坑 5（离线依赖） |
| 点某功能报 No handler | 坑 14（通道对齐） |
| 日程出现重复条目 | 坑 13（同步去重） |
| push 被拒 | 坑 17、21（浅克隆/仓库损坏） |
| CI 失败 | 坑 18、22（electron 元数据 / YAML） |
