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
  "meeting": {
    "meetingType": "wemeet",
    "meetingId": "123456789",
    "meetingCode": "123-456-789",
    "joinUrl": "https://meeting.tencent.com/dm/r/XXXXXXX",
    "meetingSubject": "项目周会"
  }
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
| `meeting` | object | - | 在线会议信息，不传则为无会议日程 |
| `meeting.meetingType` | string | ✅ (meeting存在时) | `"wemeet"` \| `"custom"` |
| `meeting.meetingId` | string | - | 腾讯会议ID（wemeet 类型） |
| `meeting.meetingCode` | string | - | 会议号 |
| `meeting.joinUrl` | string | ✅ (meeting存在时) | 入会链接 |
| `meeting.meetingSubject` | string | - | 会议主题 |

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

仅组织者可修改。支持修改标题、描述、时间、地点和会议信息。

**请求体（所有字段可选，仅传需要修改的字段）：**

```json
{
  "title": "项目周会（更新）",
  "description": "更新后的议程",
  "startTime": "2025-06-24 15:00:00",
  "endTime": "2025-06-24 16:00:00",
  "location": "会议室B",
  "meeting": {
    "meetingType": "custom",
    "joinUrl": "https://zoom.us/j/123456789",
    "meetingSubject": "项目周会"
  }
}
```

> 传入 `meeting: null` 可清除会议信息。

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
