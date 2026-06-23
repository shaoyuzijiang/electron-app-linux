# IM 即时通讯 — 客户端 API 接口文档

> 本文档供大模型或开发者生成客户端代码使用，包含完整的请求/响应格式、数据模型、WebSocket 协议和示例。
>
> 相关文档：[im.md](./im.md)（IM 设计方案与架构约束）| [interface.md](./interface.md)（认证/用户/会议 API 接口文档）

---

## 一、基础信息

| 项目 | 说明 |
|------|------|
| Base URL | `http://<host>:<port>` |
| WebSocket URL | `ws://<host>:<port>/ws/chat?token=<accessToken>` |
| 认证方式 | JWT Bearer Token（REST API 请求头 `Authorization: Bearer <accessToken>`） |
| WebSocket 认证 | URL Query 参数 `?token=<accessToken>` |
| 内容类型 | `application/json`（文件上传除外） |
| 时间格式 | ISO 8601 字符串，如 `2025-06-23 14:30:00`（SQLite `datetime('now','localtime')` 格式） |

---

## 二、统一响应格式

### 成功响应

```json
{
  "code": 0,
  "data": { ... }
}
```

- `code` 固定为 `0`，表示成功
- `data` 为业务数据，类型和结构取决于具体接口

### 错误响应

```json
{
  "code": 401,
  "message": "Token expired"
}
```

- `code` 为 HTTP 状态码
- `message` 为错误描述
- 常见错误码：`400`（参数错误）、`401`（未认证/Token过期）、`403`（无权限）、`404`（不存在）、`429`（限流/锁定）、`500`（服务器错误）

---

## 三、认证接口

### 3.1 获取 RSA 公钥

客户端登录前需先获取公钥，用于加密登录请求。

```
GET /api/auth/public-key
```

**无需认证**

**响应：**

```json
{
  "code": 0,
  "data": {
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9...\n-----END PUBLIC KEY-----"
  }
}
```

### 3.2 登录

```
POST /api/auth/login
```

**请求体需加密**（RSA + AES-256-CBC 混合加密）：

1. 客户端生成随机 AES-256 密钥（32 字节）和 IV（16 字节）
2. 用服务端 RSA 公钥（OAEP/SHA-256）加密 `aesKey(32) + iv(16)`，得到 `encryptedKey`
3. 用 AES-256-CBC 加密 JSON 请求体，Base64 编码得到 `ciphertext`
4. 发送加密包：

```json
{
  "encryptedKey": "<Base64编码的RSA加密结果>",
  "ciphertext": "<Base64编码的AES加密结果>",
  "nonce": "<随机字符串，防重放>",
  "timestamp": "<时间戳，防重放>"
}
```

**加密前的明文 JSON 请求体：**

```json
{
  "email": "user@example.com",
  "password": "plaintext_password"
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIs...",
    "expiresIn": 7200,
    "tokenType": "Bearer"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| accessToken | string | 访问令牌，有效期 2h，用于 REST API 和 WebSocket 认证 |
| refreshToken | string | 刷新令牌，有效期 30d，用于获取新的 accessToken |
| expiresIn | number | accessToken 有效期（秒），默认 7200（2h），取决于 `JWT_ACCESS_EXPIRES_IN` 环境变量 |
| tokenType | string | 固定 `"Bearer"` |

**错误响应：**

| HTTP 状态码 | message | 说明 |
|-------------|---------|------|
| 400 | Missing email or password | 缺少参数 |
| 401 | Invalid credentials | 邮箱或密码错误 |
| 429 | Account temporarily locked... | 登录失败次数过多，账户被临时锁定 |

### 3.3 刷新 Token

```
POST /api/auth/refresh
```

**请求体需加密**（与登录相同的加密方式）。

**加密前的明文 JSON 请求体：**

```json
{
  "refreshToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIs...",
    "expiresIn": 7200,
    "tokenType": "Bearer"
  }
}
```

> 旧 refreshToken 在使用后立即失效（一次性使用），客户端需用新返回的 refreshToken 替换本地存储。

### 3.4 获取用户信息

```
GET /api/auth/profile
```

**需要认证**

**响应：**

```json
{
  "code": 0,
  "data": {
    "id": "user@example.com",
    "username": "张三",
    "role": "user",
    "email": "user@example.com"
  }
}
```

---

## 四、数据模型

### 4.1 Message 消息对象

```typescript
{
  id: string;              // 消息ID (UUID)
  conversationId: string;  // 会话ID
  senderId: string;        // 发送者用户ID（系统消息为 "system"）
  senderName: string;      // 发送者用户名（系统消息为 "System"）
  type: string;            // "text" | "image" | "file" | "card" | "system"
  content: string;         // 消息内容
  createdAt: string;       // 发送时间 "2025-06-23 14:30:00"
}
```

**消息内容格式：**

| type | content 格式 | 示例 |
|------|-------------|------|
| `text` | 纯文本字符串 | `"你好"` |
| `image` | JSON 字符串 | `{"url":"/uploads/123_abc.jpg","filename":"photo.jpg","size":102400}` |
| `file` | JSON 字符串 | `{"url":"/uploads/456_def.pdf","filename":"doc.pdf","size":2048000}` |
| `card` | JSON 字符串 | `{"title":"快速会议","description":"121274901","url":"","meetingCode":"121274901","status":"进行中"}` |
| `system` | JSON 字符串 | `{"action":"conversation_created","conversationId":"xxx","conversationName":"群聊1"}` |

**卡片消息（`card`）content 字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 是 | 卡片标题（≤200字符），快速会议固定为 `"快速会议"` |
| description | string | 否 | 卡片描述（≤1000字符），会议邀请卡片为会议号 |
| url | string | 否 | 卡片链接 URL，会议邀请卡片为空字符串 |
| imageUrl | string | 否 | 卡片封面图片 URL（通常为 `/uploads/xxx.jpg`） |
| meetingCode | string | 否 | 会议号（仅会议邀请卡片使用） |
| status | string | 否 | 会议状态，如 `"进行中"`（仅会议邀请卡片使用） |

### 4.2 ConversationListItem 会话列表项

```typescript
{
  id: string;              // 会话ID
  type: string;            // "single" | "group"
  name: string;            // 会话名称（单聊为对方用户名，群聊为群名）
  avatar: string;          // 会话头像URL（单聊为空，群聊可空）
  createdBy: string;       // 创建者用户ID
  role: string;            // 当前用户在此会话中的角色 "owner" | "admin" | "member"
  createdAt: string;       // 创建时间
  updatedAt: string;       // 最后更新时间
  lastReadAt: string;      // 当前用户最后已读时间（空字符串表示从未已读）
  lastMessage: Message | null;  // 最后一条消息（无消息时为 null）
  unreadCount: number;     // 未读消息数
  members: Array<{         // 会话成员列表
    userId: string;
    username: string;
    role: string;          // "owner" | "admin" | "member"
  }>;
}
```

### 4.3 ConversationDetail 会话详情

```typescript
{
  id: string;
  type: string;            // "single" | "group"
  name: string;            // 会话名称（单聊为空字符串，群聊为群名）
  avatar: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  role: string;            // 当前用户在此会话中的角色
  lastReadAt: string;
  members: Array<{
    userId: string;
    username: string;
    role: string;
    joinedAt: string;      // 加入时间
  }>;
}
```

### 4.4 User 用户对象（搜索结果）

```typescript
{
  id: string;              // 用户ID
  username: string;        // 用户名
  phone: string;           // 手机号（脱敏）
  email: string;           // 邮箱
  role: string;            // 角色 "user" | "admin" | "superadmin"
  departmentId: string;    // 部门ID
  departmentName: string;  // 部门名称
  expiresAt: string;       // 账号过期时间
  createdAt: string;       // 创建时间
}
```

### 4.5 UploadFile 上传响应

```typescript
{
  url: string;             // 文件访问路径 "/uploads/123_abc.jpg"
  filename: string;        // 原始文件名
  size: number;            // 文件大小（字节）
  mimetype: string;        // MIME 类型
  isImage: boolean;        // 是否为图片
}
```

---

## 五、REST API 接口

> 所有接口（除认证接口外）均需在请求头携带 `Authorization: Bearer <accessToken>`

### 5.1 创建会话

```
POST /api/chat/conversations
```

**请求体：**

```json
{
  "type": "single",
  "name": "",
  "memberIds": ["target@example.com"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | `"single"` 或 `"group"` |
| name | string | 群聊必填 | 群聊名称（≤64字符），单聊忽略 |
| memberIds | string[] | 是 | 成员用户ID数组。单聊恰好1个（不能是自己）；群聊至少1个 |

**响应（单聊）：**

```json
{
  "code": 0,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

> 单聊会话如已存在，返回已有会话ID（不重复创建）。

**错误：**

| HTTP | message | 说明 |
|------|---------|------|
| 400 | Single chat requires exactly one member | 单聊成员数不为1 |
| 400 | Cannot create single chat with yourself | 不能和自己单聊 |
| 400 | Group name is required | 群聊缺少名称 |
| 400 | At least one member is required | 群聊成员为空 |
| 400 | Invalid conversation type | type 不是 single/group |
| 404 | Target user not found / User xxx not found | 目标用户不存在 |

### 5.2 获取会话列表

```
GET /api/chat/conversations
```

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "id": "conv-uuid-1",
      "type": "single",
      "name": "李四",
      "avatar": "",
      "createdBy": "me@example.com",
      "role": "member",
      "createdAt": "2025-06-23 10:00:00",
      "updatedAt": "2025-06-23 14:30:00",
      "lastReadAt": "2025-06-23 14:00:00",
      "lastMessage": {
        "id": "msg-uuid",
        "conversationId": "conv-uuid-1",
        "senderId": "lisi@example.com",
        "senderName": "李四",
        "type": "text",
        "content": "你好",
        "createdAt": "2025-06-23 14:30:00"
      },
      "unreadCount": 2,
      "members": [
        { "userId": "lisi@example.com", "username": "李四", "role": "member" }
      ]
    }
  ]
}
```

> 会话按 `updatedAt` 降序排列。单聊的 `name` 自动显示为对方用户名，`members` 仅包含对方。群聊的 `members` 包含全部成员。

### 5.3 获取会话详情

```
GET /api/chat/conversations/:id
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "id": "conv-uuid-1",
    "type": "group",
    "name": "项目组",
    "avatar": "",
    "createdBy": "me@example.com",
    "createdAt": "2025-06-23 10:00:00",
    "updatedAt": "2025-06-23 14:30:00",
    "role": "owner",
    "lastReadAt": "2025-06-23 14:00:00",
    "members": [
      { "userId": "me@example.com", "username": "张三", "role": "owner", "joinedAt": "2025-06-23 10:00:00" },
      { "userId": "lisi@example.com", "username": "李四", "role": "member", "joinedAt": "2025-06-23 10:00:00" }
    ]
  }
}
```

**错误：**

| HTTP | message | 说明 |
|------|---------|------|
| 404 | Conversation not found or access denied | 会话不存在或非成员 |

### 5.4 获取历史消息

```
GET /api/chat/conversations/:id/messages
```

**查询参数：**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| before | string (ISO时间) | 无 | 返回此时间之前的消息（向上翻页） |
| after | string (ISO时间) | 无 | 返回此时间之后的消息（增量同步） |
| limit | number | 50 | 返回条数，最大 200 |

**示例请求：**

```
GET /api/chat/conversations/conv-uuid-1/messages?limit=50
GET /api/chat/conversations/conv-uuid-1/messages?before=2025-06-23 12:00:00&limit=20
GET /api/chat/conversations/conv-uuid-1/messages?after=2025-06-23 12:00:00
```

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "id": "msg-uuid-1",
      "conversationId": "conv-uuid-1",
      "senderId": "lisi@example.com",
      "senderName": "李四",
      "type": "text",
      "content": "你好",
      "createdAt": "2025-06-23 14:00:00"
    },
    {
      "id": "msg-uuid-2",
      "conversationId": "conv-uuid-1",
      "senderId": "me@example.com",
      "senderName": "张三",
      "type": "text",
      "content": "你好呀",
      "createdAt": "2025-06-23 14:01:00"
    }
  ]
}
```

> 消息按 `createdAt` **升序**排列（从旧到新）。使用 `before` 向上翻页时，取传入时间点之前最近的消息；使用 `after` 做增量同步时，取传入时间点之后的所有消息。

**错误：**

| HTTP | message | 说明 |
|------|---------|------|
| 403 | Access denied | 非会话成员 |

### 5.5 发送消息（HTTP 备用通道）

> 正常情况下通过 WebSocket 发送消息，此接口为 WebSocket 不可用时的备用通道。

```
POST /api/chat/conversations/:id/messages
```

**请求体：**

```json
{
  "type": "text",
  "content": "你好"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 否 | 默认 `"text"`，可选 `"text"` / `"image"` / `"file"` / `"card"` |
| content | string | 是 | 消息内容（纯文本或 JSON 字符串） |

**响应：**

```json
{
  "code": 0,
  "data": {
    "id": "msg-uuid-3",
    "conversationId": "conv-uuid-1",
    "senderId": "me@example.com",
    "senderName": "张三",
    "type": "text",
    "content": "你好",
    "createdAt": "2025-06-23 14:35:00"
  }
}
```

> 通过 HTTP 发送的消息也会通过 WebSocket 推送给会话其他在线成员。

**错误：**

| HTTP | message | 说明 |
|------|---------|------|
| 400 | Content is required | content 为空 |
| 400 | Message exceeds max length (5000 chars) | 消息超长 |
| 403 | Access denied | 非会话成员 |

### 5.6 标记已读

```
POST /api/chat/conversations/:id/read
```

**无请求体**

**响应：**

```json
{
  "code": 0,
  "data": {
    "message": "Marked as read"
  }
}
```

> 标记后，服务端通过 WebSocket 向会话其他在线成员推送已读回执。

### 5.7 获取会话成员列表

```
GET /api/chat/conversations/:id/members
```

**响应：**

```json
{
  "code": 0,
  "data": [
    { "userId": "me@example.com", "username": "张三", "role": "owner", "joinedAt": "2025-06-23 10:00:00" },
    { "userId": "lisi@example.com", "username": "李四", "role": "member", "joinedAt": "2025-06-23 10:00:00" }
  ]
}
```

### 5.8 添加成员（群聊）

```
POST /api/chat/conversations/:id/members
```

**请求体：**

```json
{
  "userId": "wangwu@example.com"
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "message": "Member added"
  }
}
```

> 被添加的用户如果在线，会通过 WebSocket 收到 `added_to_conversation` 事件。

**错误：**

| HTTP | message | 说明 |
|------|---------|------|
| 400 | Can only add members to group chat | 非群聊会话 |
| 400 | userId is required | 缺少 userId |
| 403 | Only owner or admin can add members | 权限不足 |
| 404 | Conversation not found or access denied | 会话不存在 |
| 404 | User not found | 目标用户不存在 |

### 5.9 移除成员（群聊）

```
DELETE /api/chat/conversations/:id/members/:userId
```

**无请求体**

**响应：**

```json
{
  "code": 0,
  "data": {
    "message": "Member removed"
  }
}
```

> 普通成员可以移除自己（退出群聊）。被移除的用户如果在线，会通过 WebSocket 收到 `removed_from_conversation` 事件。

**错误：**

| HTTP | message | 说明 |
|------|---------|------|
| 400 | Can only remove members from group chat | 非群聊会话 |
| 403 | Only owner or admin can remove members | 移除他人时权限不足 |

### 5.10 获取总未读消息数

```
GET /api/chat/unread/count
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "count": 5
  }
}
```

### 5.11 获取在线用户列表

```
GET /api/chat/online
```

**响应：**

```json
{
  "code": 0,
  "data": [
    { "userId": "lisi@example.com", "username": "李四" },
    { "userId": "wangwu@example.com", "username": "王五" }
  ]
}
```

### 5.12 上传文件/图片

```
POST /api/chat/upload
```

**请求格式：** `multipart/form-data`

| 字段 | 类型 | 说明 |
|------|------|------|
| file | File | 上传的文件 |

**限制：**

- 最大文件大小：20MB
- 允许的 MIME 类型：
  - 图片：`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/bmp`
  - 文档：`application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-powerpoint`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`
  - 压缩包：`application/zip`, `application/x-rar-compressed`, `application/x-7z-compressed`
  - 文本：`text/plain`, `text/csv`, `application/json`
  - 音视频：`video/mp4`, `video/quicktime`, `audio/mpeg`, `audio/mp4`

**响应：**

```json
{
  "code": 0,
  "data": {
    "url": "/uploads/1719120000000_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg",
    "filename": "photo.jpg",
    "size": 102400,
    "mimetype": "image/jpeg",
    "isImage": true
  }
}
```

**错误：**

| HTTP | message | 说明 |
|------|---------|------|
| 400 | No file uploaded | 未上传文件 |
| 400 | File exceeds max size (20MB) | 文件过大 |
| 400 | File type not allowed | 文件类型不允许 |

### 5.13 用户搜索

新建会话时搜索用户。

```
GET /api/user-picker/search?keyword=<关键词>
GET /api/user-picker/search?q=<关键词>
```

**需要认证**

| 参数 | 类型 | 说明 |
|------|------|------|
| keyword | string | 搜索关键词（与 `q` 二选一） |
| q | string | 搜索关键词（与 `keyword` 二选一） |

> 搜索按用户名和用户ID模糊匹配，最多返回 50 条结果。关键词为空时返回空数组。

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "id": "lisi@example.com",
      "username": "李四",
      "phone": "138****0000",
      "email": "lisi@example.com",
      "role": "user",
      "departmentId": "dept-001",
      "departmentName": "技术部",
      "expiresAt": "2025-12-31 23:59:59",
      "createdAt": "2025-01-01 00:00:00"
    }
  ]
}
```

---

## 六、文件访问

上传的文件通过 HTTP 静态服务访问，无需认证。

```
GET /uploads/<filename>
```

- `filename` 为上传时返回的 `url` 字段中 `/uploads/` 后面的部分
- 服务端使用 `path.basename` 防止目录遍历攻击
- 文件不存在返回 404

**示例：**

```
GET /uploads/1719120000000_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg
```

---

## 七、WebSocket 协议

### 7.1 连接

```
ws://<host>:<port>/ws/chat?token=<accessToken>
```

- 连接路径固定为 `/ws/chat`
- Access Token 通过 URL Query 参数 `token` 传递
- 同一用户最多 5 个并发连接（多端同时在线）

### 7.2 WebSocket 关闭码

| 关闭码 | 说明 |
|--------|------|
| 4001 | 认证失败（Token 无效/过期/被撤销） |
| 4002 | 连接数超限（同一用户超过 5 个连接） |

### 7.3 客户端 → 服务端消息

#### 7.3.1 发送消息 `send`

```json
{
  "action": "send",
  "conversationId": "conv-uuid-1",
  "type": "text",
  "content": "你好"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| action | string | 是 | 固定 `"send"` |
| conversationId | string | 是 | 目标会话ID |
| type | string | 否 | 默认 `"text"`，可选 `"text"` / `"image"` / `"file"` / `"card"` |
| content | string | 是 | 消息内容（纯文本或 JSON 字符串，最大 5000 字符） |

> 消息保存后，服务端会向会话所有在线成员（**包括发送者自己**，用于多端同步）推送 `message` 事件。

#### 7.3.2 标记已读 `markRead`

```json
{
  "action": "markRead",
  "conversationId": "conv-uuid-1"
}
```

#### 7.3.3 输入中状态 `typing`

```json
{
  "action": "typing",
  "conversationId": "conv-uuid-1"
}
```

#### 7.3.4 心跳响应 `pong`

```json
{
  "action": "pong"
}
```

> 服务端每 30 秒发送 `ping`，客户端需回复 `pong`，否则连接会被断开。

### 7.4 服务端 → 客户端消息

#### 7.4.1 连接成功 `connected`

WebSocket 连接建立后，服务端立即发送：

```json
{
  "action": "connected",
  "data": {
    "userId": "me@example.com",
    "username": "张三",
    "onlineUsers": ["me@example.com", "lisi@example.com"]
  }
}
```

#### 7.4.2 新消息推送 `message`

当会话中有新消息时（通过 WebSocket 或 HTTP 发送），所有在线成员收到：

```json
{
  "action": "message",
  "data": {
    "id": "msg-uuid-3",
    "conversationId": "conv-uuid-1",
    "senderId": "lisi@example.com",
    "senderName": "李四",
    "type": "text",
    "content": "你好",
    "createdAt": "2025-06-23 14:35:00"
  }
}
```

> 发送者自己也会收到此消息（用于多端同步）。

#### 7.4.3 已读回执 `read`

当会话其他成员标记已读时：

```json
{
  "action": "read",
  "conversationId": "conv-uuid-1",
  "userId": "lisi@example.com"
}
```

#### 7.4.4 输入中状态 `typing`

当会话其他成员正在输入时：

```json
{
  "action": "typing",
  "conversationId": "conv-uuid-1",
  "userId": "lisi@example.com",
  "username": "李四"
}
```

#### 7.4.5 心跳 `ping`

```json
{
  "action": "ping"
}
```

> 客户端收到后需回复 `{"action":"pong"}`。

#### 7.4.6 被加入会话 `added_to_conversation`

当被其他用户添加到群聊时：

```json
{
  "action": "added_to_conversation",
  "data": {
    "conversationId": "conv-uuid-1"
  }
}
```

#### 7.4.7 被移出会话 `removed_from_conversation`

当被移出群聊时：

```json
{
  "action": "removed_from_conversation",
  "data": {
    "conversationId": "conv-uuid-1"
  }
}
```

#### 7.4.8 错误 `error`

```json
{
  "action": "error",
  "message": "Message rate limit exceeded"
}
```

常见错误消息：

| message | 说明 |
|---------|------|
| Invalid JSON format | 消息不是合法 JSON |
| Unknown action: xxx | 未知的 action |
| conversationId and content are required | send 缺少必填字段 |
| Message exceeds max length (5000 chars) | 消息超过 5000 字符 |
| You are not a member of this conversation | 非会话成员 |
| Message rate limit exceeded | 发送频率超限（10条/秒） |
| Failed to save message | 消息保存失败 |

---

## 八、客户端开发指南

### 8.1 认证流程

```
1. GET  /api/auth/public-key → 获取 RSA 公钥
2. POST /api/auth/login（加密请求）→ 获取 accessToken + refreshToken
3. 连接 WebSocket: ws://host/ws/chat?token=<accessToken>
4. Access Token 过期 → WebSocket 收到关闭码 4001
5. POST /api/auth/refresh（加密请求）→ 获取新 token
6. 用新 token 重新连接 WebSocket
```

### 8.2 登录加密流程

```
1. 生成随机 AES Key (32 bytes) 和 IV (16 bytes)
2. RSA-OAEP(SHA-256) 加密 aesKey + iv → encryptedKey (Base64)
3. AES-256-CBC 加密 JSON 请求体 → ciphertext (Base64)
4. 生成随机 nonce 和当前 timestamp（防重放攻击）
5. POST { encryptedKey, ciphertext, nonce, timestamp }
```

### 8.3 WebSocket 连接管理

- **心跳保活**：服务端每 30 秒发送 `{"action":"ping"}`，客户端必须回复 `{"action":"pong"}`，超时未回复则服务端断开连接
- **自动重连**：连接断开后，延迟 3 秒重连，建议指数退避（3s → 6s → 12s → ...）
- **Token 过期重连**：收到关闭码 4001 时，先调用 refresh 获取新 token，再重新连接
- **多端登录**：同一用户支持最多 5 个 WebSocket 连接，超出会收到关闭码 4002

### 8.4 消息发送流程

**文本消息（WebSocket）：**

```json
{
  "action": "send",
  "conversationId": "conv-uuid-1",
  "type": "text",
  "content": "你好"
}
```

**图片/文件消息（先上传再发送）：**

```
1. POST /api/chat/upload (multipart/form-data, field=file)
   → 返回 { url, filename, size, mimetype, isImage }

2. WebSocket 发送:
   {
     "action": "send",
     "conversationId": "conv-uuid-1",
     "type": "image",  // 或 "file"
     "content": "{\"url\":\"/uploads/xxx.jpg\",\"filename\":\"photo.jpg\",\"size\":102400}"
   }
```

**卡片消息 — 会议邀请（WebSocket）：**

```json
{
  "action": "send",
  "conversationId": "conv-uuid-1",
  "type": "card",
  "content": "{\"title\":\"快速会议\",\"description\":\"121274901\",\"url\":\"\",\"meetingCode\":\"121274901\",\"status\":\"进行中\"}"
}
```

> 会议邀请卡片由客户端集成腾讯会议 SDK 生成。流程：调用 SDK `quickMeeting` 发起快速会议 → 监听 `OnJoinMeeting` 回调获取 `meeting_code`（回调 `code` 为字符串 `"0"` 表示成功）→ 调用 SDK `AddUsersWithParam` 呼叫会话其他成员入会 → 发送卡片消息。卡片 `title` 固定为 `"快速会议"`，`description` 为会议号，`url` 为空。

### 8.5 离线消息同步

```
1. 上线后 GET /api/chat/conversations → 获取会话列表（含 unreadCount）
2. 对每个有未读消息的会话:
   GET /api/chat/conversations/:id/messages?after=<lastReadAt>
   → 获取未读消息
3. 用户查看会话后:
   POST /api/chat/conversations/:id/read
   或 WebSocket: {"action":"markRead","conversationId":"xxx"}
```

### 8.6 历史消息分页

```
1. 首次加载: GET /api/chat/conversations/:id/messages?limit=50
2. 向上翻页: GET /api/chat/conversations/:id/messages?before=<最早一条消息的createdAt>&limit=50
3. 增量同步: GET /api/chat/conversations/:id/messages?after=<最新一条消息的createdAt>
```

### 8.7 速率限制

- WebSocket 消息发送频率限制：每秒最多 10 条
- 超限时收到 `{"action":"error","message":"Message rate limit exceeded"}`
- REST API 登录/刷新有独立的速率限制，失败次数过多会临时锁定账户

---

## 九、配置参数

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| WS_HEARTBEAT_INTERVAL | 30 | WebSocket 心跳间隔（秒） |
| WS_MAX_CONNECTIONS_PER_USER | 5 | 单用户最大 WebSocket 连接数 |
| CHAT_MESSAGE_MAX_LENGTH | 5000 | 单条消息最大长度（字符） |
| CHAT_UPLOAD_MAX_SIZE | 20 | 文件上传最大大小（MB） |
| JWT_ACCESS_EXPIRES_IN | 2h | Access Token 有效期 |
| JWT_REFRESH_EXPIRES_IN | 30d | Refresh Token 有效期 |
