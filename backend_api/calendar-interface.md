# 日程功能 — 客户端 API 接口文档

> 本文档供大模型或开发者生成客户端代码使用，包含完整的请求/响应格式、数据模型和示例。
>
> 相关文档：[calendar.md](./calendar.md)（日程设计方案与架构约束）| [interface.md](./interface.md)（认证/用户/会议 API 接口文档）

---

## 一、基础信息

| 项目 | 说明 |
|------|------|
| Base URL | `http://<host>:<port>` |
| 认证方式 | JWT Bearer Token（请求头 `Authorization: Bearer <accessToken>`） |
| 内容类型 | `application/json` |
| 时间格式 | `YYYY-MM-DD HH:MM:SS`（如 `2025-06-24 14:30:00`），本地时间 |

---

## 二、统一响应格式

### 成功响应

```json
{
  "code": 0,
  "data": { ... }
}
```

### 错误响应

```json
{
  "code": 401,
  "message": "Token expired"
}
```

- `code` 为 HTTP 状态码
- `message` 为错误描述
- 常见错误码：`400`（参数错误）、`401`（未认证/Token过期）、`403`（无权限）、`404`（不存在）、`500`（服务器错误）

---

## 三、数据模型

### 3.1 Event 日程对象

```typescript
{
  id: string;                  // 日程ID (UUID)
  title: string;               // 日程标题
  description: string;         // 日程描述
  organizerId: string;         // 组织者用户ID
  organizerName: string;       // 组织者用户名
  startTime: string;           // 开始时间 "2025-06-24 14:00:00"
  endTime: string;             // 结束时间 "2025-06-24 15:00:00"
  location: string;            // 地点
  status: string;              // "active" | "cancelled"
  meeting: {                   // 在线会议信息（无会议时为 null）
    meetingType: string;       // "wemeet" | "custom"
    meetingId: string;         // 腾讯会议ID（wemeet 类型）
    meetingCode: string;       // 会议号（如 "123-456-789"）
    joinUrl: string;           // 入会链接
    meetingSubject: string;    // 会议主题
  } | null;
  participants: Participant[]; // 参与者列表
  createdAt: string;           // 创建时间
  updatedAt: string;           // 更新时间
}
```

### 3.2 Participant 参与者对象

```typescript
{
  userId: string;       // 用户ID
  username: string;     // 用户名
  status: string;       // "pending" | "accepted" | "declined" | "tentative"
}
```

### 3.3 FreeBusySlot 忙碌时段

```typescript
{
  userId: string;
  username: string;
  busySlots: {
    startTime: string;  // 忙碌开始时间
    endTime: string;    // 忙碌结束时间
    title: string;      // 日程标题
  }[]
}
```

---

## 四、接口详解

### 4.1 创建日程

```
POST /api/calendar/events
```

**需要认证**

**请求体：**

```json
{
  "title": "项目周会",
  "description": "讨论本周工作进展",
  "startTime": "2025-06-24 14:00:00",
  "endTime": "2025-06-24 15:00:00",
  "location": "会议室A",
  "participantIds": ["user_002", "user_003"],
  "createMeeting": true
}
```

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 日程标题，1-200 字符 |
| `description` | string | - | 日程描述，最多 2000 字符 |
| `startTime` | string | ✅ | 开始时间 `YYYY-MM-DD HH:MM:SS` |
| `endTime` | string | ✅ | 结束时间，须晚于 startTime |
| `location` | string | - | 地点，最多 200 字符 |
| `participantIds` | string[] | - | 参与者用户ID列表（组织者自动加入，无需传入） |
| `createMeeting` | boolean | - | 是否同步创建腾讯会议，`true` 时服务端调用腾讯会议 REST API 创建会议并将会议信息关联到日程，默认 `false` |

> **`createMeeting` 说明**：当设为 `true` 时，服务端会以当前用户为创建者，调用腾讯会议 `POST /v1/meetings` 接口创建预约会议（`type=0`），使用 `title` 作为会议主题，`startTime`/`endTime` 转换为 Unix 时间戳传入，`participantIds` 中的有效用户作为 invitees。创建成功后会议信息（meetingId、meetingCode、joinUrl 等）自动写入日程。如果腾讯会议 API 调用失败，整个日程创建请求将返回错误。

**响应：**

```json
{
  "code": 0,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "title": "项目周会",
    "description": "讨论本周工作进展",
    "organizerId": "user_001",
    "organizerName": "张三",
    "startTime": "2025-06-24 14:00:00",
    "endTime": "2025-06-24 15:00:00",
    "location": "会议室A",
    "status": "active",
    "meeting": {
      "meetingType": "wemeet",
      "meetingId": "123456789",
      "meetingCode": "123-456-789",
      "joinUrl": "https://meeting.tencent.com/dm/r/XXXXXXX",
      "meetingSubject": "项目周会"
    },
    "participants": [
      { "userId": "user_001", "username": "张三", "status": "accepted" },
      { "userId": "user_002", "username": "李四", "status": "pending" },
      { "userId": "user_003", "username": "王五", "status": "pending" }
    ],
    "createdAt": "2025-06-24 10:00:00",
    "updatedAt": "2025-06-24 10:00:00"
  }
}
```

**错误响应：**

| HTTP 状态码 | message | 说明 |
|-------------|---------|------|
| 400 | Missing required field: title | 缺少标题 |
| 400 | Missing required field: startTime | 缺少开始时间 |
| 400 | Missing required field: endTime | 缺少结束时间 |
| 400 | End time must be after start time | 结束时间须晚于开始时间 |
| 400 | Title must be 1-200 characters | 标题长度不符 |
| 404 | User xxx not found | 参与者用户不存在 |
| 500 | WeMeet API credentials not configured | 未配置腾讯会议 API 凭证（createMeeting=true 时） |
| 500 | Failed to create meeting: xxx | 腾讯会议创建失败（createMeeting=true 时） |

---

### 4.2 日程列表

```
GET /api/calendar/events
```

**需要认证**

返回当前用户作为组织者或参与者的日程列表，支持按日期范围和状态筛选。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `startDate` | string | - | 筛选开始日期 `YYYY-MM-DD`，默认当天 |
| `endDate` | string | - | 筛选结束日期 `YYYY-MM-DD`，默认当天后 30 天 |
| `status` | string | - | 筛选状态 `active` \| `cancelled`，默认 `active` |

**请求示例：**

```bash
curl "http://localhost:3000/api/calendar/events?startDate=2025-06-01&endDate=2025-06-30&status=active" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "title": "项目周会",
      "description": "讨论本周工作进展",
      "organizerId": "user_001",
      "organizerName": "张三",
      "startTime": "2025-06-24 14:00:00",
      "endTime": "2025-06-24 15:00:00",
      "location": "会议室A",
      "status": "active",
      "meeting": null,
      "participants": [
        { "userId": "user_001", "username": "张三", "status": "accepted" }
      ],
      "createdAt": "2025-06-24 10:00:00",
      "updatedAt": "2025-06-24 10:00:00"
    }
  ]
}
```

---

### 4.3 日程详情

```
GET /api/calendar/events/:id
```

**需要认证**

仅组织者或参与者可查看。

**请求示例：**

```bash
curl http://localhost:3000/api/calendar/events/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**响应：** 同 4.1 创建日程的响应格式。

**错误响应：**

| HTTP 状态码 | message | 说明 |
|-------------|---------|------|
| 404 | Event not found | 日程不存在 |
| 403 | Access denied | 无权限查看 |

---

### 4.4 修改日程

```
PUT /api/calendar/events/:id
```

**需要认证**

仅组织者可修改。支持修改标题、描述、时间、地点。

> 会议信息由创建日程时的 `createMeeting` 标识决定，不支持通过修改接口直接变更。会议信息的后续更新由腾讯会议 Webhook 自动同步。

**请求体（所有字段可选，仅传需要修改的字段）：**

```json
{
  "title": "项目周会（更新）",
  "description": "更新后的议程",
  "startTime": "2025-06-24 15:00:00",
  "endTime": "2025-06-24 16:00:00",
  "location": "会议室B"
}
```

**响应：** 返回更新后的完整日程对象（同 4.1 响应格式）。

**错误响应：**

| HTTP 状态码 | message | 说明 |
|-------------|---------|------|
| 404 | Event not found | 日程不存在 |
| 403 | Only organizer can update event | 仅组织者可修改 |
| 400 | End time must be after start time | 结束时间须晚于开始时间 |
| 400 | Cannot update a cancelled event | 已取消的日程不可修改 |

---

### 4.5 取消日程

```
DELETE /api/calendar/events/:id
```

**需要认证**

仅组织者可取消。取消为软删除（status 改为 `cancelled`），数据保留。

**请求示例：**

```bash
curl -X DELETE http://localhost:3000/api/calendar/events/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "message": "Event cancelled successfully"
  }
}
```

**错误响应：**

| HTTP 状态码 | message | 说明 |
|-------------|---------|------|
| 404 | Event not found | 日程不存在 |
| 403 | Only organizer can cancel event | 仅组织者可取消 |
| 400 | Event already cancelled | 日程已取消 |

---

### 4.6 添加参与者

```
POST /api/calendar/events/:id/participants
```

**需要认证**

仅组织者可添加参与者。已存在的参与者不会被重复添加。

**请求体：**

```json
{
  "userId": "user_004"
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "message": "Participant added",
    "participant": {
      "userId": "user_004",
      "username": "赵六",
      "status": "pending"
    }
  }
}
```

**错误响应：**

| HTTP 状态码 | message | 说明 |
|-------------|---------|------|
| 400 | userId is required | 缺少 userId |
| 404 | Event not found | 日程不存在 |
| 403 | Only organizer can manage participants | 仅组织者可管理参与者 |
| 404 | User not found | 用户不存在 |
| 409 | User is already a participant | 用户已是参与者 |
| 400 | Cannot add participant to a cancelled event | 已取消的日程不可操作 |

---

### 4.7 删除参与者

```
DELETE /api/calendar/events/:id/participants/:userId
```

**需要认证**

仅组织者可删除参与者。组织者自身不可被删除。

**请求示例：**

```bash
curl -X DELETE http://localhost:3000/api/calendar/events/a1b2c3d4/participants/user_004 \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "message": "Participant removed"
  }
}
```

**错误响应：**

| HTTP 状态码 | message | 说明 |
|-------------|---------|------|
| 404 | Event not found | 日程不存在 |
| 403 | Only organizer can manage participants | 仅组织者可管理参与者 |
| 403 | Cannot remove the organizer | 不可删除组织者 |
| 404 | Participant not found | 参与者不存在 |
| 400 | Cannot remove participant from a cancelled event | 已取消的日程不可操作 |

---

### 4.8 参与者列表

```
GET /api/calendar/events/:id/participants
```

**需要认证**

组织者或参与者均可查看。

**响应：**

```json
{
  "code": 0,
  "data": [
    { "userId": "user_001", "username": "张三", "status": "accepted" },
    { "userId": "user_002", "username": "李四", "status": "pending" },
    { "userId": "user_003", "username": "王五", "status": "declined" }
  ]
}
```

**错误响应：**

| HTTP 状态码 | message | 说明 |
|-------------|---------|------|
| 404 | Event not found | 日程不存在 |
| 403 | Access denied | 无权限查看 |

---

### 4.9 查询用户空闲时间

```
GET /api/calendar/freebusy
```

**需要认证**

查询指定用户在指定时间段内的忙碌时段。客户端可据此计算空闲时段。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userIds` | string | ✅ | 用户ID列表，逗号分隔（如 `user_001,user_002`） |
| `startTime` | string | ✅ | 查询开始时间 `YYYY-MM-DD HH:MM:SS` |
| `endTime` | string | ✅ | 查询结束时间 `YYYY-MM-DD HH:MM:SS` |

**请求示例：**

```bash
curl "http://localhost:3000/api/calendar/freebusy?userIds=user_001,user_002&startTime=2025-06-24%2009:00:00&endTime=2025-06-24%2018:00:00" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "userId": "user_001",
      "username": "张三",
      "busySlots": [
        {
          "startTime": "2025-06-24 10:00:00",
          "endTime": "2025-06-24 11:00:00",
          "title": "项目周会"
        },
        {
          "startTime": "2025-06-24 14:00:00",
          "endTime": "2025-06-24 15:30:00",
          "title": "需求评审"
        }
      ]
    },
    {
      "userId": "user_002",
      "username": "李四",
      "busySlots": [
        {
          "startTime": "2025-06-24 09:30:00",
          "endTime": "2025-06-24 10:30:00",
          "title": "晨会"
        }
      ]
    }
  ]
}
```

> **客户端计算空闲时段**：将查询时间范围 `[startTime, endTime]` 视为完整时间轴，去除所有 busySlots 后的剩余时段即为空闲时段。多个用户的空闲时段取交集即为共同空闲时间。

**错误响应：**

| HTTP 状态码 | message | 说明 |
|-------------|---------|------|
| 400 | userIds is required | 缺少 userIds |
| 400 | startTime is required | 缺少 startTime |
| 400 | endTime is required | 缺少 endTime |
| 400 | End time must be after start time | 结束时间须晚于开始时间 |
| 400 | Too many users (max 20) | 查询用户数超过限制 |

## 五、实时推送（WebSocket）

日程的创建、修改、取消、参与者变更都会通过 WebSocket（`/ws/chat`，与 IM 共用）即时推送给组织者和所有参与者，使在线客户端无需轮询即可同步最新状态。

**推送触发场景：**

| 场景 | action | 触发接口 / 事件 |
|------|--------|-----------------|
| 创建日程 | `event_create` | `POST /api/calendar/events` / Webhook `meeting.created` |
| 修改日程 | `event_update` | `PUT /api/calendar/events/:id` / Webhook `meeting.updated` |
| 取消日程 | `event_cancel` | `DELETE /api/calendar/events/:id` / Webhook `meeting.canceled` |
| 添加参与者 | `event_update` | `POST /api/calendar/events/:id/participants` |
| 删除参与者 | `event_update` | `DELETE /api/calendar/events/:id/participants/:userId` |

> **关于 Webhook 触发场景的补充说明**（v1.1+）：
> 腾讯会议 `meeting.created` 事件 payload 中**不携带** `hosts` / `invitees` 列表，因此本服务在收到该事件后会主动调用腾讯会议"查询会议详情"接口（`GET /v1/meetings/{meetingId}`）拉取 `hosts` / `current_hosts` / `current_co_hosts` / `participants` 字段来补全参与者列表，确保被邀请用户能收到 `event_create` 推送。该接口调用失败时不会阻塞日程创建（按"只有 organizer"的最小集写入，后续可通过 `meeting.updated` 事件重新同步）。该补全逻辑由 `wemeetService.queryMeetingUsers(meetingId, organizerId)` 封装。

**Webhook 接收时序**（v1.1+）：

腾讯会议 webhook 一般有 **5 秒超时**，超时会被重发甚至标记失败。本服务采用"**校验通过立即 200、业务异步处理**"模式：

```
收到 POST /api/wemeet/webhook
  │
  ├─ 解密 body.data（如有）                ← 失败 → 401（不重发业务）
  ├─ SHA1 签名校验                        ← 失败 → 401
  │
  ├─ ctx.body = "successfully received callback"   ← 校验一过就立即 200
  ├─ setImmediate(() => handleWebhookEvent(...))  ← 业务挪到下一 tick
  │
  └─ koa 立即 flush 响应
       （腾讯会议在 ~ms 级别收到 200）
```

| 阶段 | 行为 | 超时风险 |
|------|------|----------|
| 校验（解密+签名） | 同步，必须在响应前完成 | 无（纯 CPU） |
| 响应 200 | `ctx.body = "successfully received callback"` 后立即返回 | 无 |
| 业务处理（日程读写、WS 推送、`queryMeetingById` 补全） | `setImmediate` 异步执行，不阻塞响应 | 业务再慢也不影响 webhook 响应 |

**业务失败处理**：
- 单条 `meetingInfo` 处理失败 → 仅写日志，不影响其他条
- 整体 handler 抛错 → 由 `setImmediate` 回调的 `.catch` 兜底记日志
- 校验失败（解密/签名错）→ 仍返回 401，由腾讯会议自动重试
- **业务执行失败不会触发腾讯会议重试**（因为已返回 200），如需补单请人工介入



```json
{
  "action": "event_create",
  "data": {
    "id": "uuid-xxx",
    "title": "项目周会",
    "description": "",
    "organizerId": "user_001",
    "organizerName": "张三",
    "startTime": "2025-06-25 14:00:00",
    "endTime": "2025-06-25 15:00:00",
    "location": "会议室A",
    "status": "active",
    "meeting": {
      "meetingType": "wemeet",
      "meetingId": "15750965903409460315",
      "meetingCode": "445999969",
      "joinUrl": "https://meeting.tencent.com/dm/r/XXXXXXX",
      "meetingSubject": "项目周会"
    },
    "participants": [
      { "userId": "user_001", "username": "张三", "status": "accepted" },
      { "userId": "user_002", "username": "李四", "status": "pending" }
    ],
    "createdAt": "2025-06-25T14:00:00.000Z",
    "updatedAt": "2025-06-25T14:00:00.000Z"
  }
}
```

**接收端处理建议：**

- `event_create`：将新日程插入本地列表（按 startTime 排序），无需重新拉取。
- `event_update`：替换本地对应 ID 的日程（注意：可能是参与者列表变化，未变化字段原样保留即可）。
- `event_cancel`：从本地列表移除该日程（`status='cancelled'`）。
- 离线用户：下次打开客户端时通过 `GET /api/calendar/events` 拉取最新列表补齐。
- 仅组织者 / 参与者会收到推送，其他用户即使订阅了同一账号也不会收到。
