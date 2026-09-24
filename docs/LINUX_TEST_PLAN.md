# Linux ARM64 统一工程 — 测试计划与用例清单

> 适用仓库：`tencent-meeting-sdk-demo`（统一三端工程）
> 执行命令：`npm run verify`（全量自动层）＋ 真机清单（本文第五节）
> 最近更新：2026-09-24

---

## 一、目的与教训

所有"真机上才发现"的问题，按类别归档如下。测试体系按类别逐类封堵，每类问题必须有对应的自动化用例，防止复发。

| # | 真机问题 | 根因类别 | 封堵用例 |
|---|---|---|---|
| 1 | 摄像头开启崩溃（`wl_egl_window_retain` SIGSEGV） | 厂商图形栈（Mali EGL 被优先加载） | `validate-graphics-env.js`：补丁加载顺序、LD_LIBRARY_PATH 排序、LD_PRELOAD 清空、启动器/DEB 静态断言 |
| 2 | `InitializeStateIng ipc connect failed!` | 库搜索顺序错误（系统库抢占 SDK 私有库） | 同上（断言"私有库最前"顺序） |
| 3 | `No handler registered: accounts-save` | IPC 通道缺失 | `validate-linux-parity.js` A 层：preload↔Linux 通道全量对齐 |
| 4 | 共享屏幕报"不支持 ShowScreenCastView" | 原生接口被条件编译裁剪（`#ifndef __linux__`） | `validate-linux-parity.js` B 层：解析裁剪接口，禁止 adapter 暴露 |
| 5 | `Cannot find module '../../sdk_mgmt/user-picker'` | 交付白名单遗漏运行时依赖目录 | `validate-linux-parity.js` E 层：交付树闭包测试 + 白名单覆盖断言 |
| 6 | 预定会议不出现在日历 | 三端共同产品缺口（会议/日程未联动） | `validate-linux-parity.js` D 层：联动 payload 与契约字段静态断言 |

---

## 二、测试分层

| 层 | 名称 | 执行环境 | 覆盖内容 |
|---|---|---|---|
| S1 | 平台能力契约 | 任意平台 | 三端 capabilities 声明合法、Linux 支持集与禁用集精确匹配 |
| S2 | SDK adapter 生命周期 | 任意平台（mock addon） | 初始化/登录/入会/离会/ForceQuit/回调超时/会话代次/输入校验/SSO 白名单 |
| S3 | 图形环境 | 任意平台 | Wayland 会话 source 厂商补丁 → Mesa 路径优先 → SDK 私有路径前插 → LD_PRELOAD 清空；缺补丁分支；启动器/DEB 静态断言 |
| S4 | 功能对齐（parity） | 任意平台 | ① preload 129 通道 ↔ Linux 注册全量对齐 + Mac 专属允许清单；② 原生裁剪接口不可暴露；③ 后端处理器行为（成功/未登录/缓存）；④ Renderer 联动；⑤ 交付树闭包 + 白名单覆盖 |
| M1 | 真机构建 | 麒麟 ARM64 | `npm run demo:deb` 全链路（离线安装→headers→SDK→addon→ELF→DEB→校验） |
| M2 | 真机运行 | 麒麟桌面 | `[Boot]` 启动追踪全通过、登录页渲染、四页签 |
| M3 | 真机功能 | 麒麟桌面 | 登录/登出、会议列表、预定（含日程联动）、入会/摄像头、快速会议、IM、日程、通讯录、头像菜单、scheme 唤起、日志上传 |
| M4 | 真机安装 | 麒麟桌面 | DEB SHA-256、安装/卸载、桌面入口、sandbox 权限 |

---

## 三、S4 交付树闭包测试（新增，针对 #5 类问题）

对离线传输包白名单内的**每一个交付文件**：

1. **JS require 闭包**：从入口（`main.js`、`main-darwin-win32.js`、`bootstrap/preload.js`、`scripts/validate-*.js`）出发，广度优先解析全部相对 `require()`；解析目标必须属于交付集合，或属于豁免前缀（`node_modules`、`build/`、`output/`、`wemeet_sdk/`、Electron 内置模块）。
2. **Shell 引用闭包**：`scripts/`、`packaging/` 内脚本引用的 `scripts/<file>`、`packaging/<file>` 必须存在于交付集合。
3. **白名单覆盖**：Linux 运行链路 `require` 到的顶层目录（如 `sdk_mgmt`）必须同时出现在传输包白名单与 DEB staging 清单。

---

## 四、自动化执行

```bash
npm run verify        # S1 + S2 + S3 + S4 全量（打包前必须全绿）
npm run doctor        # 真机环境/图形预检
npm run demo:deb      # M1 自动链路
```

退出码非 0 即失败；任何新增 IPC 通道、adapter 方法、原生依赖、交付目录，都必须先补对应用例再合入。

---

## 五、真机（M2/M3/M4）用例清单

### M2 启动
- [ ] `npm start` 后 `[Boot]` 日志走到"全部启动步骤完成"
- [ ] `[Boot] 渲染进程: 页面加载完成`，登录页可见
- [ ] 无 `Exiting GPU process` 导致的黑屏/无窗口

### M3 功能
- [ ] 登录 → 进入会议页；退出登录可回登录页
- [ ] 会议列表加载；列表"入会"默认开摄像头；摄像头不崩溃
- [ ] 快速会议；离会
- [ ] 预定会议 → 预定成功弹窗 → **日历对应日期出现该日程且可入会**
- [ ] 会议号点击复制；取消会议即时移除
- [ ] 消息：会话列表、收发消息、图片显示、发起会话选人、群管理
- [ ] 日程：新建/查看/取消；与会议联动的日程带"腾讯会议"标识
- [ ] 通讯录：部门树展开、成员分页、搜索（失败时页面显示具体后端错误）
- [ ] 头像菜单：修改密码弹窗、上传日志（SDK 页面）、退出登录
- [ ] scheme 唤起：`xdg-open "wemeetsdk://…"` 拉起应用并入会
- [ ] 登录页服务端设置：切换环境、恢复默认

### M4 安装
- [ ] `sha256sum -c *.deb.sha256` 通过
- [ ] `dpkg-deb --info` 显示 Version/Installed-Size/Depends 合理
- [ ] 安装后 `tencent-meeting-sdk-linux-demo` 与桌面菜单均可启动
- [ ] `chrome-sandbox` 权限 `root:root 4755`
- [ ] 卸载后可重装，用户数据（设置）保留或按预期清理

---

## 六、已知边界（Linux 3.26 SDK 不提供，禁止 UI 暴露）

录音笔、录制查看、Rooms 控制器、AI 小助手、字幕、会中选人、UserConfigService 偏好设置、
`ShowScreenCastView` 投屏视图（会中工具栏共享不受影响）、WebView 页签、企业 SSO 管理页。

以上由 S1 契约与 S4-B 裁剪断言双重锁定；如 SDK 升级提供接口，需同步更新两处断言并真机验证。
