# PC端如何将自定义邀请通讯录组件居中置顶显示

## 一、背景与需求

在腾讯会议 Electron SDK 集成中，会中窗口（会议室内界面）是由 SDK 渲染的独立窗口。当用户在会中点击"邀请"按钮时，SDK 会通过回调通知应用层。应用层需要展示一个自定义的通讯录选人组件，要求：

1. **独立窗口**：选人组件是一个独立的 `BrowserWindow`，而非嵌入在主窗口的 overlay 遮罩层中
2. **居中置顶**：选人窗口要定位在 SDK 会中窗口的正上方，且始终置顶（`alwaysOnTop`）
3. **窗口跟随**：通过 SDK 提供的 `GetMeetingWindowInfo` 接口获取 SDK 会中窗口的实时位置和尺寸（注意：不是 Electron 主窗口的位置），据此计算选人窗口的坐标

### 改造前的问题

改造前，选人组件以 overlay 遮罩层的形式嵌入在主窗口的 `index.html` 中：
- SDK 回调通过 IPC 转发到主窗口渲染进程 → 渲染进程显示/隐藏 overlay
- 选人组件与主窗口耦合，无法独立于主窗口存在
- 无法精确定位到会中窗口上方

### 改造后的架构

改造后，选人组件是一个完全独立的 `BrowserWindow`：
- SDK 回调到达主进程 → 主进程调用 `GetMeetingWindowInfo()` 获取 **SDK 会中窗口**（非 Electron 主窗口）的位置 → 创建独立窗口并居中定位到 SDK 会中窗口上方
- 选人组件拥有独立的 HTML/CSS/JS 文件，与主窗口完全解耦
- `OnAddUsersResult` 回调直接发送到选人窗口

---

## 二、整体流程

```
用户在会中点击"邀请"
        │
        ▼
SDK 触发 OnInviteUsers / OnInviteMeeting 回调
        │
        ▼
主进程 handleSDKCallback() 接收回调
        │
        ▼
调用 openUserPickerWindow(type, cbMsg)
        │
        ├── 调用 GetMeetingWindowInfo() 获取会中窗口位置
        │       返回 JSON: { code, msg, data: { in_meeting_mode, in_screen_share_mode, in_meeting_min_wnd_mode, window_rect: { x, y, width, height } } }
        │       封装函数解析后返回: { x, y, width, height }
        │
        ├── 计算选人窗口坐标（居中于会中窗口）
        │       posX = meetingWin.x + (meetingWin.width - pickerWidth) / 2
        │       posY = meetingWin.y + (meetingWin.height - pickerHeight) / 2
        │
        ├── new BrowserWindow({ x, y, alwaysOnTop: true, ... })
        │
        └── 加载 user-picker.html
                │
                ▼
        did-finish-load 事件 → webContents.send('picker-init-data', { type, cbMsg })
                │
                ▼
        选人窗口渲染进程接收数据 → 初始化通讯录 UI
                │
                ▼
        用户选择人员 → 点击"确认邀请"
                │
                ▼
        调用 addUsersWithParam(jsonParam) → SDK 呼叫用户入会
                │
                ▼
        调用 closeUserPickerWindow() → 关闭选人窗口
```

---

## 三、关键实现细节

### 3.1 获取会中窗口位置 — `GetMeetingWindowInfo`

SDK 提供 `GetMeetingWindowInfo()` 接口（>= 3.12.300），返回当前会中窗口的位置和尺寸信息。仅支持桌面端（Windows / macOS / Linux）。

**接口原型：** `string GetMeetingWindowInfo()` — 无参数，返回 JSON 字符串。

**返回值 JSON 结构：**

```json5
{
  "code": 0,               // 0=成功, -1015=不在会议中
  "msg": "",
  "data": {
    "in_meeting_mode": true,           // 是否处于会中状态
    "in_screen_share_mode": false,     // 是否处于屏幕共享状态
    "in_meeting_min_wnd_mode": false,  // 是否处于最小化状态
    "window_rect": {                   // 会中窗口位置和尺寸
      "x": 100,
      "y": 200,
      "width": 1280,
      "height": 720
    }
  }
}
```

> **重要：** `window_rect` 仅在 **会中且非屏幕共享、非窗口最小化** 时有效，否则字段值可能为 0 或无效。

**封装函数：** 需要解析嵌套的 `data.window_rect`，而非直接使用顶层字段：

```javascript
// main.js

/**
 * 获取会中窗口位置信息
 * @returns {object|null} { x, y, width, height } 或 null
 *
 * GetMeetingWindowInfo() 返回 JSON 字符串，结构如下：
 * {
 *   "code": 0,
 *   "msg": "",
 *   "data": {
 *     "in_meeting_mode": true,
 *     "in_screen_share_mode": false,
 *     "in_meeting_min_wnd_mode": false,
 *     "window_rect": { "x": 0, "y": 0, "width": 0, "height": 0 }
 *   }
 * }
 * 仅在会中且非屏幕共享、非最小化时 window_rect 有效。
 */
function getMeetingWindowInfo() {
  if (!wemeetSdk) return null;
  try {
    const raw = wemeetSdk.GetMeetingWindowInfo();
    if (!raw || raw === '') return null;
    const result = JSON.parse(raw);
    // code 不为 0 表示不在会中或调用非法
    if (!result || result.code !== 0 || !result.data) return null;
    const data = result.data;
    // 非会中状态、屏幕共享状态、最小化状态时 window_rect 无效
    if (!data.in_meeting_mode || data.in_screen_share_mode || data.in_meeting_min_wnd_mode) {
      console.warn('[选人组件] 会中窗口状态不适合定位:', {
        in_meeting_mode: data.in_meeting_mode,
        in_screen_share_mode: data.in_screen_share_mode,
        in_meeting_min_wnd_mode: data.in_meeting_min_wnd_mode,
      });
      return null;
    }
    const rect = data.window_rect;
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  } catch (err) {
    console.error('[选人组件] GetMeetingWindowInfo 失败:', err.message);
    return null;
  }
}
```

**常见错误码：**

| code | 说明 |
|------|------|
| `0` | 成功 |
| `-1015` | 不在会议中 |
| 空字符串 | SDK 未初始化（非法调用） |

### 3.2 创建选人窗口并居中定位 — `openUserPickerWindow`

```javascript
// main.js

let userPickerWindow = null; // 选人组件独立窗口引用

/**
 * 打开选人组件独立窗口，定位到会中窗口上方
 * @param {string} type - 'invite_users' 或 'invite_meeting'
 * @param {string} cbMsg - SDK 回调原始 JSON 消息
 */
function openUserPickerWindow(type, cbMsg) {
  // 如果已有选人窗口则先关闭
  if (userPickerWindow && !userPickerWindow.isDestroyed()) {
    userPickerWindow.close();
    userPickerWindow = null;
  }

  // 获取会中窗口位置
  const meetingWinInfo = getMeetingWindowInfo();

  const pickerWidth = 800;
  const pickerHeight = 560;

  let posX, posY;
  if (meetingWinInfo && typeof meetingWinInfo.x === 'number' && typeof meetingWinInfo.y === 'number') {
    // 居中于 SDK 会中窗口
    posX = Math.round(meetingWinInfo.x + (meetingWinInfo.width - pickerWidth) / 2);
    posY = Math.round(meetingWinInfo.y + (meetingWinInfo.height - pickerHeight) / 2);
    console.log('[选人组件] 基于 SDK 会中窗口定位:', { posX, posY });
  } else {
    // 回退：居中于主窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      const mainBounds = mainWindow.getBounds();
      posX = Math.round(mainBounds.x + (mainBounds.width - pickerWidth) / 2);
      posY = Math.round(mainBounds.y + (mainBounds.height - pickerHeight) / 2);
    } else {
      posX = undefined;
      posY = undefined;
    }
  }

  userPickerWindow = new BrowserWindow({
    width: pickerWidth,
    height: pickerHeight,
    minWidth: 700,
    minHeight: 480,
    x: posX,
    y: posY,
    title: type === 'invite_meeting' ? '邀请参会' : '邀请成员',
    resizable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,    // 始终置顶，覆盖在会中窗口上方
    skipTaskbar: true,    // 不在任务栏显示
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  userPickerWindow.loadFile(path.join(__dirname, 'renderer', 'user-picker.html'));

  // 窗口加载完成后发送回调数据
  userPickerWindow.webContents.on('did-finish-load', () => {
    userPickerWindow.webContents.send('picker-init-data', { type, cbMsg });
  });

  userPickerWindow.on('closed', () => {
    userPickerWindow = null;
  });
}
```

**窗口定位计算示意图：**

```
┌─────────────────────────────────────────────────┐
│              SDK 会中窗口 (由 SDK 渲染)            │
│              位置由 GetMeetingWindowInfo() 获取    │
│                                                 │
│        ┌───────────────────────────┐            │
│        │   选人组件窗口 (800×560)    │            │
│        │                           │            │
│        │  居中于 SDK 会中窗口上方    │            │
│        │                           │            │
│        └───────────────────────────┘            │
│                                                 │
└─────────────────────────────────────────────────┘

posX = meetingWin.x + (meetingWin.width - 800) / 2
posY = meetingWin.y + (meetingWin.height - 560) / 2

注意：meetingWin 的坐标来自 SDK 的 GetMeetingWindowInfo()，
而非 Electron mainWindow.getBounds()。
SDK 会中窗口是独立于 Electron 主窗口的，
其位置可能与 Electron 主窗口完全不同。
```

### 3.3 SDK 回调路由改造

改造前，`OnInviteUsers` 和 `OnInviteMeeting` 回调通过 IPC 转发到主窗口渲染进程；改造后，直接在主进程创建选人窗口：

```javascript
// main.js — handleSDKCallback() 中

} else if (func === 'OnInviteUsers') {
  console.log('[选人组件] 收到 OnInviteUsers 回调:', msg);
  openUserPickerWindow('invite_users', cbMsg);
} else if (func === 'OnInviteMeeting') {
  console.log('[选人组件] 收到 OnInviteMeeting 回调:', msg);
  openUserPickerWindow('invite_meeting', cbMsg);
} else if (func === 'OnAddUsersResult') {
  console.log('[选人组件] 收到 OnAddUsersResult 回调, code:', code, 'msg:', msg);
  // 邀请结果直接发送到选人窗口（而非主窗口）
  if (userPickerWindow && !userPickerWindow.isDestroyed()) {
    userPickerWindow.webContents.send('add-users-result-callback', cbMsg);
  }
}
```

### 3.4 IPC 接口

主进程注册以下 IPC 接口供渲染进程调用：

```javascript
// main.js

// 获取部门树
ipcMain.handle('get-department-tree', async () => {
  const accessToken = await getValidAccessToken();
  const data = await api.getDepartmentTree(accessToken);
  return { success: true, data };
});

// 获取部门下的用户（分页）
ipcMain.handle('get-department-users', async (_event, { departmentId, recursive, page, pageSize }) => {
  const accessToken = await getValidAccessToken();
  const data = await api.getDepartmentUsers(accessToken, departmentId, { recursive, page, pageSize });
  return { success: true, data };
});

// 搜索用户
ipcMain.handle('search-users', async (_event, { query }) => {
  const accessToken = await getValidAccessToken();
  const data = await api.searchUsers(accessToken, query);
  return { success: true, data };
});

// 获取会中窗口位置信息
ipcMain.handle('get-meeting-window-info', async () => {
  const info = getMeetingWindowInfo();
  return { success: !!info, data: info };
});

// 关闭选人组件窗口
ipcMain.handle('close-user-picker-window', async () => {
  if (userPickerWindow && !userPickerWindow.isDestroyed()) {
    userPickerWindow.close();
    userPickerWindow = null;
  }
  return { success: true };
});
```

### 3.5 Preload 桥接

```javascript
// preload.js

contextBridge.exposeInMainWorld('electronAPI', {
  // ... 其他接口 ...

  // 选人组件数据接口
  getDepartmentTree: () => ipcRenderer.invoke('get-department-tree'),
  getDepartmentUsers: (departmentId, recursive, page, pageSize) =>
    ipcRenderer.invoke('get-department-users', { departmentId, recursive, page, pageSize }),
  searchUsers: (query) => ipcRenderer.invoke('search-users', { query }),

  // 选人组件独立窗口接口
  getMeetingWindowInfo: () => ipcRenderer.invoke('get-meeting-window-info'),
  closeUserPickerWindow: () => ipcRenderer.invoke('close-user-picker-window'),

  // 监听选人组件初始化数据（主进程发送）
  onPickerInitData: (callback) => {
    ipcRenderer.on('picker-init-data', (_event, data) => callback(data));
  },

  // 监听邀请结果回调
  onAddUsersResultCallback: (callback) => {
    ipcRenderer.on('add-users-result-callback', (_event, msg) => callback(msg));
  },
});
```

### 3.6 选人窗口渲染进程初始化

选人窗口加载 `user-picker.html` 后，通过 `onPickerInitData` 接收主进程发送的初始化数据：

```javascript
// renderer/js/user-picker.js

window.electronAPI.onPickerInitData(({ type, cbMsg }) => {
  try {
    const cb = JSON.parse(cbMsg);
    pickerCallbackType = type;

    // 解析已在会中的用户列表
    if (type === 'invite_users' && cb.param) {
      let data = typeof cb.param === 'string' ? JSON.parse(cb.param) : cb.param;
      pickerInMeetingUserIds = data.users || [];
    }

    // 更新标题
    const titleEl = document.getElementById('userPickerTitle');
    if (type === 'invite_meeting') {
      titleEl.textContent = '邀请参会';
      document.title = '邀请参会';
    } else {
      titleEl.textContent = '邀请成员';
      document.title = '邀请成员';
    }

    // 加载部门树和用户列表
    loadPickerDeptTree();
    renderPickerSelectedUsers();
  } catch (err) {
    console.error('[选人组件] 初始化数据解析失败:', err);
  }
});
```

### 3.7 确认邀请与关闭窗口

```javascript
// renderer/js/user-picker.js

async function confirmInviteUsers() {
  if (pickerSelectedUsers.size === 0) return;

  const userIds = Array.from(pickerSelectedUsers.keys());
  const jsonParam = JSON.stringify({
    users: userIds.map((id) => ({ user_id: id })),
  });

  try {
    const result = await window.electronAPI.addUsersWithParam(jsonParam);
    if (!result.success) {
      alert('邀请失败: ' + (result.message || '未知错误'));
      return;
    }
    // 调用成功后关闭选人窗口
    window.electronAPI.closeUserPickerWindow();
  } catch (err) {
    alert('邀请失败: ' + err.message);
  }
}
```

---

## 四、文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `main.js` | 修改 | 新增 `userPickerWindow` 变量；`OnInviteUsers`/`OnInviteMeeting` 改为调用 `openUserPickerWindow()`；`OnAddUsersResult` 转发到选人窗口；新增 `getMeetingWindowInfo()` 和 `openUserPickerWindow()` 函数；新增 `get-meeting-window-info` 和 `close-user-picker-window` IPC |
| `preload.js` | 修改 | 新增 `getMeetingWindowInfo`、`closeUserPickerWindow`、`onPickerInitData`；移除旧的 `onInviteUsersCallback`/`onInviteMeetingCallback` |
| `renderer/user-picker.html` | **新增** | 选人组件独立窗口 HTML |
| `renderer/js/user-picker.js` | 重写 | 移除 overlay 逻辑，改为通过 `onPickerInitData` 接收初始化数据，关闭窗口调用 `closeUserPickerWindow` |
| `renderer/css/user-picker.css` | 重写 | 移除 overlay 遮罩层样式，改为全屏 flex 容器布局，头部支持 `-webkit-app-region: drag` 拖拽 |
| `renderer/index.html` | 修改 | 移除选人组件 overlay HTML 容器和 `user-picker.css`/`user-picker.js` 引用 |
| `renderer/js/meeting.js` | 修改 | 移除 `initUserPickerEvents()` 调用 |

---

## 五、窗口属性说明

选人组件 `BrowserWindow` 的关键属性：

| 属性 | 值 | 说明 |
|------|-----|------|
| `width` / `height` | 800 × 560 | 默认尺寸 |
| `minWidth` / `minHeight` | 700 × 480 | 最小尺寸 |
| `x` / `y` | 计算值 | 基于会中窗口位置居中计算 |
| `alwaysOnTop` | `true` | 始终置顶，覆盖在会中窗口上方 |
| `skipTaskbar` | `true` | 不在系统任务栏显示独立图标 |
| `minimizable` | `false` | 禁止最小化（避免用户找不到窗口） |
| `maximizable` | `false` | 禁止最大化 |
| `resizable` | `true` | 允许调整大小 |
| `frame` | `true` | 使用系统原生标题栏（含拖拽和关闭按钮） |
| `contextIsolation` | `true` | 启用上下文隔离（安全） |
| `nodeIntegration` | `false` | 禁用 Node.js 集成（安全） |

---

## 六、定位回退策略

```
1. 优先：GetMeetingWindowInfo() 返回有效数据（`code === 0` 且 `data.in_meeting_mode === true` 且非屏幕共享/非最小化）
   → 居中于 **SDK 会中窗口**（注意：这是 SDK 渲染的独立窗口，不是 Electron 主窗口）

2. 回退：GetMeetingWindowInfo() 返回空值（不在会中、屏幕共享中、最小化等）
   → 居中于 Electron 主窗口（mainWindow.getBounds()）

3. 兜底：主窗口也不存在
   → posX/posY 设为 undefined，由操作系统自动定位
```

---

## 七、回调类型说明

| 回调 | 触发场景 | `type` 值 | 窗口标题 |
|------|----------|-----------|----------|
| `OnInviteUsers` | 会中管理成员 → 邀请 | `invite_users` | 邀请成员 |
| `OnInviteMeeting` | 会中工具栏 → 邀请 | `invite_meeting` | 邀请参会 |

两种回调的选人窗口共用同一套 UI 和逻辑，仅标题文字不同。`OnInviteUsers` 回调的 `param` 中包含已在会中的用户 ID 列表（`users` 字段），选人时这些用户会显示为"已在会议中"并禁止选择。

---

## 八、启用邀请回调

在 SDK 登录成功后，需要调用以下接口启用邀请回调并隐藏 SDK 默认通讯录：

```javascript
// main.js

function enableInviteCallbacks() {
  if (!wemeetSdk || !sdkInitialized) return;
  // 会中管理成员邀请回调，enable=true, show=false 表示启用回调且隐藏SDK默认通讯录
  wemeetSdk.EnableInviteUsersCallback(true, false);
  // 会中工具栏邀请回调，enable=true, show=false
  wemeetSdk.SetNeedShareCallback(true, false);
}
```

该函数在 SDK 登录成功回调（`OnLogin`）中自动调用。

---

## 九、后端选人组件接口

选人组件的后端 API 基路径为 `/api/user-picker/`，仅需 Bearer Token 认证（普通用户即可使用）。

### 9.1 获取部门树

```
GET /api/user-picker/departments
Authorization: Bearer <accessToken>
```

返回以 `root` 为根节点的完整部门树，每个节点包含 `userCount`（直接用户数）和 `totalUserCount`（递归总用户数）。

**响应：**

```json
{
  "code": 0,
  "data": {
    "id": "root",
    "name": "全部",
    "parentId": "",
    "sortOrder": 0,
    "userCount": 2,
    "totalUserCount": 10,
    "children": [
      {
        "id": "tech",
        "name": "技术部",
        "parentId": "",
        "sortOrder": 0,
        "userCount": 3,
        "totalUserCount": 8,
        "children": []
      }
    ]
  }
}
```

### 9.2 获取部门下的用户（分页）

```
GET /api/user-picker/departments/:id/users
Authorization: Bearer <accessToken>
```

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `recursive` | string | 设为 `true` 递归获取子部门用户；根部门默认递归 |
| `page` | integer | 页码，从 1 开始，默认 1 |
| `pageSize` | integer | 每页数量，默认 50，最大 50 |

**响应：**

```json
{
  "code": 0,
  "data": {
    "list": [
      { "id": "user_001", "username": "zhangsan", "role": "user", "departmentId": "tech", "departmentName": "技术部" }
    ],
    "total": 100,
    "page": 1,
    "pageSize": 50
  }
}
```

> 选中根部门时调用 `/api/user-picker/departments/root/users?recursive=true` 可获取全部用户。返回的用户信息已脱敏，不含手机号、密码等敏感字段。

### 9.3 搜索用户

```
GET /api/user-picker/search?q=<keyword>
Authorization: Bearer <accessToken>
```

按用户名或用户 ID 模糊搜索，最多返回 50 条。

**响应：**

```json
{
  "code": 0,
  "data": [
    { "id": "user_001", "username": "zhangsan", "role": "user", "departmentId": "tech", "departmentName": "技术部" }
  ]
}
```

---

## 十、分页加载机制

部门用户列表采用分页加载，避免一次性返回大量数据：

1. 选中部门时，加载第 1 页（`page=1, pageSize=50`）
2. 渲染进程根据响应中的 `total` 和 `list.length` 判断是否有更多数据
3. 若 `page * pageSize < total`，显示"加载更多"按钮
4. 点击"加载更多"时，请求下一页，将新用户追加到列表末尾
5. 切换部门时重置分页状态，从第 1 页重新加载
