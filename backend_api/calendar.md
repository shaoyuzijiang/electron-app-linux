# 日程功能设计方案

## 一、概述

基于现有 Koa.js + SQLite 架构，实现完整的日程管理功能，支持创建/修改/取消日程、在线会议信息记录、参与者管理、用户空闲时间查询等场景。

### 技术选型

| 方面 | 选择 | 理由 |
|------|------|------|
| 数据存储 | SQLite (better-sqlite3) | 与现有架构一致，复用 user.store 的数据库连接 |
| 认证 | 复用 JWT (RS256) | 与 IM 功能一致，Bearer Token 中间件鉴权 |
| 会议信息 | 内嵌于日程表 | 会议信息作为日程的可选属性，避免额外表关联 |
| 空闲时间查询 | 基于 SQL 时间区间重叠检测 | 直接查询用户日程表，计算忙闲时段 |

### 架构图

```
客户端（Web/移动/桌面）
    │
    ├── POST /api/auth/login → 获取 accessToken
    │
    └── REST API /api/calendar/*
        ├── 日程管理（创建/修改/取消/详情/列表）
        ├── 参与者管理（添加/删除/列表）
        └── 空闲时间查询（freebusy）
```

## 二、数据库设计

> 复用 `user.store.js` 的 SQLite 数据库连接（`calendarStore.init()` 通过 `userStore.getDb()` 获取已打开的 Database 实例）。

### events 日程表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | 日程ID (UUID) |
| title | TEXT | 日程标题 |
| description | TEXT | 日程描述 |
| organizer_id | TEXT | 组织者用户ID |
| start_time | TEXT | 开始时间 (`YYYY-MM-DD HH:MM:SS`) |
| end_time | TEXT | 结束时间 (`YYYY-MM-DD HH:MM:SS`) |
| location | TEXT | 地点 |
| status | TEXT | `active` \| `cancelled` |
| meeting_id | TEXT | 在线会议ID（腾讯会议 meetingId） |
| meeting_code | TEXT | 会议号（如 `123-456-789`） |
| join_url | TEXT | 会议入会链接 |
| meeting_type | TEXT | 会议类型：`wemeet`（腾讯会议）\| `custom`（自定义会议链接） |
| meeting_subject | TEXT | 会议主题 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 最后更新时间 |

### event_participants 日程参与者表

| 字段 | 类型 | 说明 |
|------|------|------|
| event_id | TEXT | 日程ID |
| user_id | TEXT | 用户ID |
| status | TEXT | `pending` \| `accepted` \| `declined` \| `tentative` |
| PRIMARY KEY | (event_id, user_id) | 联合主键 |

> 组织者（organizer）自动作为参与者加入，状态为 `accepted`。

## 三、REST API

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/calendar/events` | 创建日程 | JWT |
| GET | `/api/calendar/events` | 日程列表（支持日期范围、状态筛选） | JWT |
| GET | `/api/calendar/events/:id` | 日程详情 | JWT |
| PUT | `/api/calendar/events/:id` | 修改日程 | JWT |
| DELETE | `/api/calendar/events/:id` | 取消日程 | JWT |
| POST | `/api/calendar/events/:id/participants` | 添加参与者 | JWT |
| DELETE | `/api/calendar/events/:id/participants/:userId` | 删除参与者 | JWT |
| GET | `/api/calendar/events/:id/participants` | 参与者列表 | JWT |
| GET | `/api/calendar/freebusy` | 查询用户空闲时间 | JWT |

## 四、业务规则

### 4.1 权限控制

- **创建日程**：任何已认证用户均可创建
- **修改/取消日程**：仅组织者（organizer）可操作
- **添加/删除参与者**：仅组织者可操作
- **查看日程详情/参与者**：组织者或参与者均可查看
- **查看日程列表**：仅返回当前用户作为组织者或参与者的日程
- **空闲时间查询**：可查询任意已认证用户，返回该用户在指定时间段内的忙碌时段

### 4.2 在线会议信息

日程创建时支持通过 `createMeeting` 布尔标识控制是否同步创建腾讯会议：

1. **同步创建腾讯会议**（`createMeeting: true`）：服务端以当前用户为创建者，调用腾讯会议 REST API（`POST /v1/meetings`）创建预约会议（`type=0`），使用日程标题作为会议主题、日程时间作为会议时间、参与者作为 invitees。创建成功后将返回的 `meetingId`、`meetingCode`、`joinUrl` 等信息自动关联到日程。如果腾讯会议 API 调用失败，整个日程创建请求失败。
2. **不创建会议**（`createMeeting: false` 或不传）：创建普通日程，不关联在线会议信息。

> 会议信息创建后，后续由腾讯会议 Webhook 自动同步更新（meeting.updated / meeting.canceled 事件）。修改日程接口不再支持直接变更会议信息。

### 4.3 空闲时间查询

给定一组用户ID和时间范围，返回每个用户在该时间段内的忙碌时段（来自未取消的日程），客户端据此计算空闲时段。

```
输入：userIds=["user1","user2"], startTime="2025-06-24 09:00:00", endTime="2025-06-24 18:00:00"
输出：
[
  {
    "userId": "user1",
    "username": "张三",
    "busySlots": [
      { "startTime": "2025-06-24 10:00:00", "endTime": "2025-06-24 11:00:00", "title": "项目周会" },
      { "startTime": "2025-06-24 14:00:00", "endTime": "2025-06-24 15:30:00", "title": "需求评审" }
    ]
  }
]
```

客户端可将所有用户的 busySlots 合并后，对时间轴取反得到共同空闲时段。

## 五、安全设计

1. **JWT 认证**：所有接口需 Bearer Token 认证
2. **权限校验**：修改/取消/参与者管理仅组织者可操作
3. **SQL 注入防护**：所有查询使用 better-sqlite3 参数绑定
4. **输入校验**：标题、描述长度限制；时间格式校验；参与者存在性校验
5. **信息脱敏**：日程列表和详情不返回参与者敏感信息（手机号、邮箱等）

## 六、文件结构

```
src/
├── store/
│   └── calendar.store.js      # 日程数据库操作（复用 user.store 的 db 连接）
├── services/
│   └── calendar.service.js    # 日程业务逻辑
├── controllers/
│   └── calendar.controller.js # 日程 REST API 控制器
└── routes/
    └── calendar.js            # 日程 REST 路由
```

## 七、认证复用说明

日程功能**不维护独立的登录认证**，完全复用 `interface.md` 中已有的 JWT 认证体系：

- **REST API 鉴权**：日程的所有 REST 接口使用标准 Bearer Token 中间件，即登录后拿到的同一个 `accessToken`
- 客户端无需做额外登录，流程如下：

```
1. POST /api/auth/login → 获取 accessToken
2. 用 accessToken 调用日程 REST API（创建日程、查询空闲时间等）
```

## 八、大模型生成客户端代码

将 `calendar-interface.md`（API 契约层）和 `calendar.md`（架构设计约束）两个文件一起提供给大模型，即可生成完整的客户端代码。

### 两个文件的分工

| 文件 | 作用 | 大模型依赖程度 |
|------|------|---------------|
| `calendar-interface.md` | API 契约层：统一响应格式、9 个 REST 接口的完整请求/响应 JSON、数据模型定义、错误码表 | 必需，生成代码的核心依据 |
| `calendar.md` | 架构背景层：技术选型理由、业务规则、安全约束、数据库设计 | 补充，帮助理解约束和边界条件 |
