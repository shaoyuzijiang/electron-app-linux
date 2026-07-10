# 腾讯会议 SDK Demo

基于 Electron + 腾讯会议 SDK 的桌面会议应用示例，支持加入会议、快速会议、预定会议、共享屏幕、IM 即时通讯、URL Scheme 唤起入会等功能。

## 功能特性

### 用户认证

- 账号密码登录（RSA + AES 混合加密传输）
- SSO 登录 / 自动登录
- Token 自动刷新（AccessToken 过期后用 RefreshToken 续期）
- 记住密码、修改密码（密码强度校验）

### 会议功能

- 加入会议、快速会议、预定会议、共享屏幕
- 会议列表展示：按日期分组、分页加载、进行中/周期标签、一键入会、会议号复制
- 预定会议详情：会议号、主题、密码、时间、入会链接，一键复制全部信息
- 会议列表自动刷新（登录/离会/入会事件触发 + 5 分钟定时轮询 + 窗口恢复刷新）
- SDK 设置、上传日志、历史会议、会议详情、录音笔、AI 小助手
- 字幕开关与设置、会中布局切换、会中窗口操作（置顶/最小化/最大化/关闭）
- 响铃邀请（开启/关闭、接受/拒绝）

### URL Scheme 唤起

- 注册 `wemeetsdk://` 协议，支持通过会议链接唤起应用自动入会
- 跨平台唤起：macOS `open-url` 事件 / Windows 单实例锁 + `second-instance` 事件
- 冷启动流程：从 `process.argv` 或 `open-url` 获取 scheme URL
- 先登录后入会：SDK 未登录时暂存 URL，待 `OnLogin` 成功回调后自动处理；若已有有效 token 则触发自动登录
- 已登录状态：直接调用 SDK `HandleSchema` 入会
- 窗口自动前置：唤起时主窗口自动恢复并聚焦
- 打包自动注册：electron-builder `protocols` 配置在 macOS 写入 `Info.plist CFBundleURLTypes`，Windows NSIS 写入注册表协议关联
- 渲染进程 IPC：`getPendingSchemeUrl` / `consumePendingSchemeUrl` / `handleScheme` 接口，可用于登录页展示"待加入会议"提示

### 企业管理（SSO 免登 Web 页面）

- 基于一次性 SSO Ticket 的免登跳转：APP 用 Access Token 申请 Ticket（`POST /api/auth/sso/ticket`），WebView 打开 `https://host/sso/redirect?ticket=xxx`，服务端 302 + `Set-Cookie` 落到目标页，Access Token 全程不出现在 URL/Referer/access log
- 受众白名单（与后端 `config.sso.audiences` 对齐）：
  - `web-user-center:chat` → `/user-center/chat`（即时通讯，无需管理员）
  - `web-user-center:organization` → `/user-center/organization-management`（组织架构，无需管理员；注：后端 /sso/redirect 302 落地时跳到 /user-center）
  - `web-user-center:role` → `/user-center/role-management`（角色管理，**仅管理员**）
- 角色控制：仅 `role === 'admin' || 'superadmin'` 在头像菜单中看到"企业管理"入口；前端预校验 + 后端 `requireAdmin` 二次校验（颁发时与兑换时各一次）
- 头像菜单：点击用户头像展开下拉，点击"企业管理"后默认打开"组织架构"
- 动态页签：在侧边栏会议页签下方新增一个可关闭的页签，标题为 webview 当前 `document.title`（实时更新）；同受众二次点击复用同一页签 + 刷新 Ticket
- 多 webview 管理：基于 `Map<tabId, {view, url, title}>` 的 WebContentsView 池，共享 bounds，仅 active 显示；退出登录/全局关闭时调用 `closeAllWebviews()` 一并清理
- 详细流程、数据模型、风险对策、安全设计见 [`backend_api/sso.md`](./backend_api/sso.md) 与 [`backend_api/sso-interface.md`](./backend_api/sso-interface.md)

### 通讯录

- 部门树浏览（展开/折叠）、部门用户列表（分页加载，每页 50 条）
- 递归查询、加载更多、按姓名关键词实时搜索（300ms 防抖）
- 本地缓存（localStorage，秒开）+ 缓存版本管理

### 会中选人组件（自定义通讯录）

- 替代 SDK 默认通讯录，独立窗口打开，自动定位到会中窗口上方
- 部门树浏览、分页加载、搜索用户、多选勾选
- 已在会议中用户标识、已选用户管理、确认邀请（SDK `AddUsersWithParam`）

### IM 即时通讯

- WebSocket 实时消息 + HTTP 备用通道（降级保证消息可达）
- 单聊 / 群聊（群名称、成员搜索选择）
- 会话列表（按最近消息排序、未读数角标、搜索过滤）
- 消息类型：文本、图片（点击预览）、文件（点击下载）、系统消息、会议邀请卡片
- 文件上传（20MB 限制，MIME 白名单校验）
- 消息分页（加载更多历史消息，保持滚动位置）
- IndexedDB 本地缓存（消息和会话列表都本地优先，秒开）
- 消息增量同步（仅拉取本地最新消息之后的新消息，10s 内重复进入同一会话跳过）
- 会话列表请求节流：本地缓存优先渲染 + 30 秒节流 + WebSocket 事件驱动主动刷新（被加入/移出会话、创建/删除会话、发送消息后）+ 60 秒兜底轮询
- 未读管理（会话级未读计数 + 总未读数角标）
- 输入中状态（3s 节流）、已读未读
- 群成员管理（角色展示、移除成员、退出群聊）
- 用户搜索（新建会话，300ms 防抖）、在线用户查询
- 会议邀请卡片消息（SDK 快速会议 → 卡片消息 → 会议结束自动置灰）
- 图片通过 IPC 带认证头请求转 base64 显示

### 日程

- 三栏布局：左侧紧凑月历 + 选中日日程 / 主区日/周/月三视图 / 右侧详情面板
- 紧凑月历：月份切换、回到今天、周末标红、当天高亮、每格日程小圆点提示（普通/会议/已取消）、"+N" 更多指示
- 主区三视图：
  - **日视图**：24 小时单列时间轴，跨天日程只显示当天部分
  - **周视图**（默认）：7 列 × 24 小时时间轴，含"当前时刻"红色时间线
  - **月视图**：日历大格子，每格显示前 3 个日程 + "+N 个日程"，点击切到日视图
- 右侧详情面板：标题、时间（含星期）、地点、组织者、关联会议卡片（可复制会议号）、参与者列表、忙碌时段查询；操作按钮（编辑/取消/加入会议/复制会议信息）
- 日程创建/编辑模态弹窗、参与者选择、组织者专属"添加参与者"入口
- 勾选"创建腾讯会议"后保存日程时自动调用腾讯会议创建接口，将会议号、入会链接等回填到日程
- 日程跨月/跨周导航自适应步长，选中日期同步；月份切换时自动夹到月末（如 1/31 → 2 月取 2/28）

### 平台与架构

- macOS Apple Silicon (arm64) & Intel (x64) 双架构支持
- Windows x64 支持（NSIS 安装包）
- RSA + AES 混合加密、公钥本地缓存
- Context Isolation（启用上下文隔离，preload 安全暴露 API）
- Token 持久化（文件存储，重启自动恢复）
- SDK 并发保护（初始化和登录并发锁）
- SDK 日志同时输出到控制台和文件，便于调试；日志时间戳使用本地时区
- 全进程日志：主进程与渲染进程 `console` 日志统一写入按小时滚动的文件，自动清理 7 天过期日志
- Windows 控制台自动 UTF-8 编码，无中文乱码

> 详细功能说明请参阅 [releasenotes.md](./releasenotes.md)。

## 环境要求

- Node.js >= 18
- Python 3（node-gyp 依赖）
- macOS：Xcode Command Line Tools
- Windows：Visual Studio Build Tools（需包含 C++ 桌面开发工作负载）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

`postinstall` 会自动编译当前平台的原生模块（macOS arm64 或 Windows x64）。

### 2. 启动开发

```bash
npm run dev
```

macOS 启动前会自动将 SDK Framework 拷贝到 Electron.app 中。Windows 需确保 SDK 运行时 DLL 在 `wemeet_sdk/win/x64/` 目录中。

## 项目结构

```
├── main.js                # Electron 主进程（入口 + 模块组装 + URL Scheme 唤起处理）
├── ipc-handlers.js        # IPC 通信接口注册
├── binding.gyp            # node-gyp 原生模块编译配置
├── entitlements.mac.plist # macOS 权限声明
├── bootstrap/
│   ├── start.js           # 启动前脚本（拷贝 SDK Framework，仅 macOS；Windows 设置控制台 UTF-8 编码）
│   └── preload.js         # 预加载脚本（IPC 桥接）
├── backend_api/
│   ├── httpClient.js      # 通用 HTTP 客户端（fetch 封装、RSA+AES 加密、publicKey 缓存）
│   ├── api.js             # 后端 API 聚合层（auth + user-picker + sso，re-export im/meeting/calendar）
│   ├── im.js              # IM 即时通讯 API（会话、消息、上传、WebSocket）
│   ├── meeting.js         # 腾讯会议 API（创建会议、会议列表）
│   ├── meeting-polling.js # 会议列表防抖刷新 + 定时轮询
│   ├── calendar.js        # 日程 API
│   ├── sso.js             # Web SSO 免登 API（一次性 Ticket 颁发）
│   ├── back-end-interface.md # 后端接口文档（认证/用户/会议 API）
│   ├── im-interface.md    # IM API 接口文档（REST/WebSocket 协议、数据模型）
│   ├── im.md              # IM 设计方案（架构、数据库、安全、部署）
│   ├── meeting-interface.md
│   ├── meeting.md
│   ├── calendar-interface.md
│   ├── calendar.md
│   ├── sso.md             # SSO 设计文档（架构、流程、风险、对策）
│   └── sso-interface.md   # SSO 接口参考
├── utils/
│   ├── logger.js          # 文件日志模块（主进程 console 劫持 + 渲染进程 IPC 转发，按小时滚动，本地时区时间戳）
│   ├── token-store.js     # Token 持久化存储
│   └── webview-manager.js # WebContentsView 多 webview 管理（tabId 维度共享 bounds、单活动态、生命周期）
├── sdk_mgmt/
│   ├── wemeet-sdk.js      # SDK 原生模块加载 + 生命周期管理（init/login/logout/回调/状态）
│   └── user-picker.js     # 选人组件窗口管理（创建、定位、通信）
├── renderer/
│   ├── login.html         # 登录页
│   ├── index.html         # 会议主页（含头像菜单、动态企业页签）
│   ├── user-picker.html   # 选人组件（独立窗口）
│   ├── css/
│   │   ├── contacts.css   # 通讯录样式
│   │   ├── im.css         # IM 聊天样式
│   │   ├── meeting.css    # 会议列表样式
│   │   ├── calendar.css   # 日程样式
│   │   ├── user-picker.css # 选人组件样式
│   │   ├── webview.css    # 内嵌 webview 容器样式
│   │   └── enterprise-sso.css # 头像菜单 + 动态企业页签样式
│   └── js/
│       ├── renderer-logger.js # 渲染进程日志拦截（console 劫持 + IPC 转发到主进程）
│       ├── contacts.js    # 通讯录模块
│       ├── im.js          # IM 即时通讯模块
│       ├── im-cache.js    # IM 本地缓存模块
│       ├── meeting.js     # 会议列表模块
│       ├── calendar.js    # 日程模块
│       ├── nav.js         # 侧边栏导航 + 动态页签注册
│       ├── webview.js     # 内嵌 webview 容器管理
│       ├── enterprise-sso.js # 企业管理 SSO 入口（头像菜单、角色判断、SSO 跳转、tab 同步）
│       └── user-picker.js # 会中选人组件渲染脚本（部门树、搜索、多选、邀请）
├── wemeet_sdk/
│   ├── wemeet.cpp         # C++ 原生模块封装（N-API）
│   ├── jsoncpp.cpp        # JsonCpp 合并源文件
│   ├── mac/Frameworks/    # macOS SDK 动态库（arm64 / x64）
│   └── win/               # Windows SDK 文件
│       ├── include/       # SDK C++ 头文件
│       ├── lib/x64/release/ # SDK 链接库（.lib）
│       └── x64/           # Windows 编译产物（.node + SDK 运行时 DLL + Release 目录）
│           └── copy.bat   # SDK 文件一键拷贝脚本
├── output/
│   └── mac/               # macOS 编译产物（.node 原生模块）
├── include/               # C++ 公共头文件（JsonCpp 等）
├── releasenotes.md        # 功能发布说明（完整功能清单）
└── PC端如何将自定义邀请通讯录组件居中置顶显示.md # 选人组件定位说明
```

## 构建原生模块

### macOS

```bash
# 仅编译 arm64 架构
npm run build:native:mac-arm64

# 编译 Intel 架构（需要 Rosetta 2）
npm run build:native:mac-x64

# 同时编译双架构
npm run build:native:mac
```

> Intel 架构编译需要 Rosetta 2，如未安装请执行：
> ```bash
> softwareupdate --install-rosetta
> ```

### Windows

```bash
# 编译 Win x64 原生模块
npm run build:native:win-x64
```

编译产物输出到 `wemeet_sdk/win/x64/`，包含 `.node` 文件。SDK 运行时 DLL 和 `Release` 目录需放置在同目录中。

#### 拷贝 SDK 运行时文件

从腾讯会议 SDK Windows 分发包拷贝运行时文件到 `wemeet_sdk/win/x64/`：

```bat
cd wemeet_sdk\win\x64
copy.bat
```

`copy.bat` 会从 `SDK_SRC` 路径拷贝以下内容：
- `*.dll` — SDK 运行时 DLL（`wemeetsdk_x64.dll`、`wemeet_base.dll`、VC 运行时等）
- `wemeetsdk_x64.lib` — 链接库（同步到 `wemeet_sdk/win/lib/x64/release/`）
- `Release\` — SDK 模块、插件、资源等目录
- `wemeet_electron_sdk.node` — 编译后的原生模块

> 使用前需修改 `copy.bat` 中的 `SDK_SRC` 变量指向实际的 SDK 分发包路径。

## 打包安装包

### macOS

```bash
# 按架构打包
npm run dist:mac:arm64       # Apple Silicon 专用
npm run dist:mac:x64         # Intel 专用
npm run dist:mac:universal   # 通用二进制（同时支持两种架构）

# 快捷打包当前平台
npm run dist
```

### Windows

```bash
# 打包 Windows x64 安装包（NSIS）
npm run dist:win:x64

# 快捷打包当前平台
npm run dist
```

打包产物输出到 `dist/` 目录。macOS 生成 `.dmg`，Windows 生成 `.exe`（NSIS 安装包）。

### 打包完整流程

```bash
# macOS
npm run build:native:mac && npm run dist:mac:universal

# Windows
npm run build:native:win-x64 && npm run dist:win:x64
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发模式 |
| `npm run build:native:mac-arm64` | 编译 macOS arm64 原生模块 |
| `npm run build:native:mac-x64` | 编译 macOS x64 原生模块 |
| `npm run build:native:mac` | 编译 macOS 双架构原生模块 |
| `npm run build:native:win-x64` | 编译 Windows x64 原生模块 |
| `npm run dist` | 打包当前平台安装包 |
| `npm run dist:mac:arm64` | 打包 macOS arm64 安装包 |
| `npm run dist:mac:x64` | 打包 macOS x64 安装包 |
| `npm run dist:mac:universal` | 打包 macOS 通用安装包 |
| `npm run dist:win:x64` | 打包 Windows x64 安装包（NSIS） |
| `npm run pack` | 仅打包目录（不生成安装包） |

## 注意事项

### URL Scheme 唤起

- 开发模式：`app.setAsDefaultProtocolClient('wemeetsdk')` 会尝试注册协议，但系统可能需要手动确认
- 打包后：electron-builder 的 `protocols` 配置会自动写入 macOS `Info.plist` 和 Windows 注册表，无需手动注册
- 唤起 URL 格式：`wemeetsdk://page/inmeeting?meeting_code=xxx&launch_id=yyy&...`，`://` 之后的部分会透传给 SDK 的 `HandleSchema` 接口
- 冷启动流程：应用未运行时被唤起 → 检测到 scheme URL → 暂存 → 自动登录（若有 token）或显示登录页 → SDK 登录成功后自动处理暂存的 URL
- 已运行时唤起：macOS 触发 `open-url` 事件；Windows 启动第二个实例触发 `second-instance` 事件，URL 转发给主实例处理
- 企业品牌配置：需在腾讯会议管理后台 → 企业管理 → 企业品牌 → SDK品牌 中配置 App scheme 为 `wemeetsdk`（与客户端注册的协议名一致）

### 企业 SSO 免登

- **服务端域名**：默认跳转地址 `https://wemeetapp.liuqi92.cn/sso/redirect?ticket=...`，如需切换到测试/预发环境，修改 `renderer/js/enterprise-sso.js` 中的 `redirectUrl` 拼装处
- **白名单必须前后端一致**：新增 audience 时同时改前端 `AUDIENCES` 与后端 `config.sso.audiences`；后端会用 `pathPrefix` 校验 `target`，前端用 `requireAdmin` 控制菜单可见性
- **角色判定**：`getProfile` 返回的 `role` 字段必须是 `'admin'` 或 `'superadmin'` 才会显示"企业管理"菜单；后端 `web-user-center:role` 在颁发和兑换时各校验一次 `isAdmin`，避免"先发后拒"
- **Ticket TTL**：60 秒，必须立即用 `webviewCreate` 加载；同受众二次点击会重新申请一次 Ticket 以确保不过期
- **退出登录清理**：`closeAllWebviews()` 会销毁所有内嵌 webview 并清空 `Map<tabId, item>`，避免下次登录时残留状态
- **不要把 Access Token 拼到 URL**：所有跳转只能携带 Ticket；如需在 WebView 内调用 API，依赖 302 时下发的 `sso_session` Cookie（同源 HttpOnly）

### macOS

- 未签名/未公证的 `.dmg` 在其他 Mac 上打开时会被 Gatekeeper 拦截，需右键 → 打开，或执行 `xattr -cr <app路径>` 去除隔离属性
- SDK Framework 在开发模式下通过 `bootstrap/start.js` 自动拷贝到 Electron.app 中，打包时通过 `extraResources` 自动处理

### Windows

- SDK 运行时 DLL（`wemeetsdk_x64.dll` 等）需放置在 `wemeet_sdk/win/x64/` 目录中，主进程会自动将该目录加入 `PATH` 环境变量
- SDK 的 `Release` 目录（含 modules、plugins、resources 等）需放置在 `wemeet_sdk/win/x64/Release/`，与 `wemeet_electron_sdk.node` 同级
- 可使用 `wemeet_sdk/win/x64/copy.bat` 一键拷贝 SDK 运行时文件
- 打包时通过 `build.win.extraResources` 自动将 `wemeet_sdk/win/x64/` 目录下所有文件包含到安装包中（无 filter 限制，确保 SDK 资源完整）
- 编译原生模块需要 Visual Studio Build Tools（C++ 桌面开发工作负载）
- 启动时自动设置控制台为 UTF-8 编码（`chcp 65001`），解决中文乱码
- SDK 内部日志同时输出到控制台（`stderr`）和日志文件，便于调试
- SDK 回调格式：当 `code=0` 且 `msg` 为空时，回调 JSON 中省略 `code`/`msg` 字段，此时应视为成功

### 更新 SDK 包

当需要替换新版腾讯会议 SDK 时，请按以下步骤操作：

1. **替换 SDK 文件**：
   - macOS：将新 SDK 的 `wemeet_sdk/mac/` 目录替换
   - Windows：将新 SDK 的头文件复制到 `wemeet_sdk/win/include/`，`.lib` 文件复制到 `wemeet_sdk/win/lib/x64/release/`，运行时 DLL 和 `Release` 目录复制到 `wemeet_sdk/win/x64/`（可使用 `wemeet_sdk/win/x64/copy.bat`，修改其中的 `SDK_SRC` 路径后执行）
2. **替换 C++ 封装**：将新 SDK Electron Demo 的 `wemeet_sdk/wemeet.cpp` 和 `wemeet_sdk/jsoncpp.cpp` 替换到项目
3. **重新编译原生模块**：SDK 更新后需要重新编译 `.node` 原生模块：
   ```bash
   # macOS
   npm run build:native:mac

   # Windows
   npm run build:native:win-x64
   ```
5. **验证**：运行 `npm run dev` 确认 SDK 加载正常后再打包

## SDK API 列表

### 基础接口

| API | 说明 |
|-----|------|
| `Init(sdkId, token)` | SDK 初始化 |
| `Login(ssoUrl)` | SSO 登录 |
| `Logout()` | 登出 |
| `JoinMeeting(meetingCode, displayName, password)` | 加入会议 |
| `JoinMeetingByJson(meetingJson)` | 通过 JSON 参数加入会议 |
| `QuickMeeting()` | 快速会议 |
| `LeaveMeeting(leaveType)` | 离开会议 |
| `GetSDKVersion()` | 获取 SDK 版本 |

### 会前界面

| API | 说明 |
|-----|------|
| `ShowPreMeetingView(uiStyle, tabId)` | 显示会前界面（Home 页） |
| `ShowJoinMeetingView()` | 显示加入会议界面 |
| `ShowScheduleMeetingView(meetingType)` | 显示预定会议界面 |
| `ShowMeetingSettingView()` | 显示设置界面 |

### 会中界面

| API | 说明 |
|-----|------|
| `ShowScreenCastView()` | 显示投屏页面 |
| `ShowScreenShareView()` | 显示屏幕共享视图 |
| `ShowHistoricalMeetingView()` | 显示历史会议 |
| `ShowMeetingDetailView(meetingId, subMeetingId, ...)` | 显示会议详情 |
| `ShowVoiceRecordView()` | 显示录音笔窗口 |
| `ShowAIAssistantView()` | 显示 AI 小助手 |
| `BringInMeetingViewTop()` | 会中窗口置顶 |
| `ManipulateWindow(action)` | 会中窗口操作 |
| `SwitchLayout(layoutJson)` | 切换会中布局 |

### 状态查询

| API | 说明 |
|-----|------|
| `IsInitialized()` | 查询是否已初始化 |
| `IsAuthorized()` | 查询是否已登录 |
| `GetCurrentSDKToken()` | 获取当前 SDK Token |
| `RefreshSDKToken(newToken)` | 刷新 SDK Token |
| `GetCurrentMeetingInfo()` | 获取当前会议信息 |
| `GetScreenShareInfo()` | 获取屏幕共享信息 |
| `GetMeetingWindowInfo()` | 获取会中窗口位置信息 |

### 字幕

| API | 说明 |
|-----|------|
| `SwitchCaption(open)` | 开关字幕 |
| `UpdateCaptionSettings(settingsJson)` | 更新字幕设置 |

### 配置与代理

| API | 说明 |
|-----|------|
| `SetUserConfiguration(userKey, userConfig)` | 设置用户配置 |
| `GetUserConfiguration(userKey)` | 获取用户配置 |
| `SetProxyInfo(proxyInfo)` | 设置代理 |
| `GetProxyInfo()` | 获取代理信息 |

### 回调控制

| API | 说明 |
|-----|------|
| `EnableInviteUsersCallback(enable, show)` | 开启邀请回调 |
| `SetNeedShareCallback(enable, show)` | 开启分享回调 |
| `EnableAddressBookCallback(enable, show)` | 开启通讯录回调 |
| `SetNeedMeetingInfoCallback(enable, show)` | 开启会议信息回调 |
| `SubscribeInMeetingActionEvent(actionType, subscribe, subscriptionJson)` | 订阅会中 Action 事件 |
| `EnableRingInvitationView(enable)` | 开启响铃邀请界面 |
| `HandleRingInvitation(accept, inviteId)` | 处理响铃邀请 |

### 其他

| API | 说明 |
|-----|------|
| `AddUsersWithParam(jsonParam)` | 添加用户（邀请入会） |
| `HandleSchema(schemaPath)` | 处理 scheme 唤起 URL，由 SDK 解析并入会 |
| `EnableCustomOrgInfo(enable)` | 开启自定义组织信息 |
| `SetCustomOrgInfo(jsonParam)` | 设置自定义组织信息 |
| `Login(ssoUrl)` | SSO URL 登录（非 JSON 方式） |
| `JumpUrlWithLoginStatus(url)` | 带登录状态跳转 URL |
| `GetUrlWithLoginStatus(url)` | 获取带登录状态的 URL |
| `ShowUploadLogsView()` | 上传日志 |
