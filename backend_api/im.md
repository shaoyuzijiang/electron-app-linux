# IM 即时通讯功能设计方案

## 一、概述

基于现有 Koa.js + SQLite 架构，实现完整的 IM 即时通讯功能，支持单聊、群聊、实时消息推送、离线消息、文件传输等完整客户端场景。

### 技术选型

| 方面 | 选择 | 理由 |
|------|------|------|
| 实时通信 | `ws` (WebSocket) | 轻量原生，与 Koa HTTP Server 共享端口 |
| 消息存储 | SQLite (better-sqlite3) | 与现有架构一致，无需引入新数据库 |
| 在线状态 | 内存 Map | 与现有 Token 黑名单方案一致 |
| 认证 | 复用 JWT (RS256) | WebSocket 连接时验证 Access Token |
| 文件传输 | 本地静态文件服务 | 存储到持久化卷 `data/uploads/` |

### 架构图

```
客户端（Web/移动/桌面）
    │
    ├── POST /api/auth/login → 获取 accessToken + refreshToken
    │
    ├── WebSocket ws://host/ws/chat?token=<accessToken>
    │   └── 实时收发消息、已读回执、输入状态、心跳保活
    │
    └── REST API /api/chat/*
        ├── 会话管理（创建/列表/成员管理）
        ├── 历史消息（分页/增量同步）
        ├── 文件上传
        └── 未读消息统计
```

## 二、数据库设计

> 复用 `user.store.js` 的 SQLite 数据库连接（`chatStore.init()` 通过 `userStore.getDb()` 获取已打开的 Database 实例），避免多连接冲突。

### conversations 会话表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | 会话ID (UUID) |
| type | TEXT | `single` \| `group` |
| name | TEXT | 群聊名称（单聊为空） |
| avatar | TEXT | 群聊头像URL |
| created_by | TEXT | 创建者用户ID |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 最后更新时间 |

### conversation_members 会话成员表

| 字段 | 类型 | 说明 |
|------|------|------|
| conversation_id | TEXT | 会话ID |
| user_id | TEXT | 用户ID |
| role | TEXT | `owner` \| `admin` \| `member` |
| joined_at | TEXT | 加入时间 |
| last_read_at | TEXT | 最后已读时间 |
| PRIMARY KEY | (conversation_id, user_id) | 联合主键 |

### messages 消息表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | 消息ID (UUID) |
| conversation_id | TEXT | 会话ID |
| sender_id | TEXT | 发送者用户ID |
| type | TEXT | `text` \| `image` \| `file` \| `system` |
| content | TEXT | 消息内容（文本或JSON） |
| created_at | TEXT | 发送时间 |

## 三、消息协议

### 客户端 → 服务端

| action | 说明 | 字段 |
|--------|------|------|
| `send` | 发送消息 | conversationId, type, content |
| `markRead` | 标记已读 | conversationId |
| `typing` | 输入中状态 | conversationId |
| `pong` | 心跳响应 | - |

### 服务端 → 客户端

| action | 说明 | 字段 |
|--------|------|------|
| `message` | 新消息推送 | data(消息对象) |
| `read` | 已读回执 | conversationId, userId |
| `typing` | 对方输入中 | conversationId, userId, username |
| `ping` | 心跳 | - |
| `error` | 错误 | message |

## 四、REST API

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/chat/conversations` | 创建会话 | JWT |
| GET | `/api/chat/conversations` | 会话列表（含未读数） | JWT |
| GET | `/api/chat/conversations/:id` | 会话详情 | JWT |
| GET | `/api/chat/conversations/:id/messages` | 历史消息（分页/增量同步） | JWT |
| POST | `/api/chat/conversations/:id/messages` | 发送消息（HTTP 备用通道） | JWT |
| POST | `/api/chat/conversations/:id/read` | 标记已读 | JWT |
| POST | `/api/chat/conversations/:id/members` | 添加成员（群聊） | JWT |
| DELETE | `/api/chat/conversations/:id/members/:userId` | 移除成员（群聊） | JWT |
| GET | `/api/chat/conversations/:id/members` | 成员列表 | JWT |
| GET | `/api/chat/unread/count` | 总未读消息数 | JWT |
| GET | `/api/chat/online` | 在线用户列表 | JWT |
| POST | `/api/chat/upload` | 上传文件/图片 | JWT |

### 用户搜索

新建会话时通过 `/api/user-picker/search` 搜索用户，支持 `keyword` 和 `q` 两种参数名：

```
GET /api/user-picker/search?keyword=<关键词>
GET /api/user-picker/search?q=<关键词>
```

### 增量同步

历史消息接口支持 `?after=<ISO8601时间戳>` 参数，返回该时间点之后的消息，用于客户端断线重连后的增量同步。

## 五、客户端对接指南

### 1. 认证流程

```
1. POST /api/auth/login → 获取 accessToken (2h) + refreshToken (30d)
2. WebSocket 连接 ws://host/ws/chat?token=<accessToken>
3. Access Token 过期 → WebSocket 收到 4001 关闭码
4. POST /api/auth/refresh → 获取新 token
5. 用新 token 重新连接 WebSocket
```

### 2. WebSocket 连接管理

- **心跳保活**：服务端每 30 秒发送 `{"action":"ping"}`，客户端需回复 `{"action":"pong"}`，超时断开
- **自动重连**：客户端检测到连接断开后，延迟 3 秒重连，指数退避
- **多端登录**：同一用户支持最多 5 个 WebSocket 连接（多设备同时在线）

### 3. 离线消息

- 用户上线时，通过 `GET /api/chat/conversations` 获取未读数
- 通过 `GET /api/chat/conversations/:id/messages?after=<lastReadAt>` 拉取未读消息
- 标记已读：发送 `{"action":"markRead","conversationId":"xxx"}` 或 `POST /api/chat/conversations/:id/read`

### 4. 文件/图片发送

```
1. POST /api/chat/upload (multipart/form-data) → 返回 { url, filename, size }
2. WebSocket 发送 {"action":"send","type":"image|file","content":"{\"url\":\"...\",\"filename\":\"...\",\"size\":12345}"}
```

## 六、安全设计

1. **WebSocket 认证**：连接时验证 JWT Access Token，过期断开
2. **权限校验**：发送消息前校验是否为会话成员
3. **XSS 防护**：消息内容存储原文，前端渲染时 HTML 转义
4. **SQL 注入防护**：所有查询使用 better-sqlite3 参数绑定
5. **消息长度限制**：单条消息最大 5000 字符
6. **速率限制**：WebSocket 消息发送频率限制（10条/秒）
7. **文件上传限制**：最大 20MB，仅允许图片/文档/压缩包类型
8. **连接数限制**：单用户最多 5 个 WebSocket 连接
9. **文件服务安全**：上传文件通过自定义中间件提供静态服务，使用 `path.basename` 防止目录遍历攻击

## 七、Docker 部署

### 环境变量

```env
# WebSocket 心跳间隔（秒），默认 30
WS_HEARTBEAT_INTERVAL=30
# 单用户最大 WebSocket 连接数，默认 5
WS_MAX_CONNECTIONS_PER_USER=5
# 单条消息最大长度（字符），默认 5000
CHAT_MESSAGE_MAX_LENGTH=5000
# 文件上传最大大小（MB），默认 20
CHAT_UPLOAD_MAX_SIZE=20
```

### 持久化

| 容器路径 | 宿主机路径 | 说明 |
|----------|-----------|------|
| `/data` | `./data` | SQLite 数据库 + 上传文件（`/data/uploads/`） |
| `/app/logs` | `./logs` | 应用日志 |

### Docker 适配要点

1. **数据目录统一**：`config.dataDir` 自动检测 Docker 环境（`/data`）与本地开发（`./data`），上传文件、数据库均使用同一根目录
2. **Dockerfile**：构建时创建 `/data/uploads` 目录并设置 `node` 用户权限
3. **entrypoint.sh**：启动时修复 `/data` 目录权限，确保 `node` 用户可写
4. **docker-compose.yml**：传递 IM 相关环境变量，挂载 `./data:/data` 持久化卷
5. **WebSocket 端口**：复用 HTTP 端口，无需额外暴露端口，反向代理需支持 WebSocket 升级

### 构建与启动

```bash
# 构建镜像
sudo docker compose build

# 启动容器
sudo docker compose up -d

# 查看日志
sudo docker compose logs -f

# 访问聊天页面
http://<服务器IP>:<PORT>/user-center/chat
```

## 八、文件结构

```
src/
├── store/
│   └── chat.store.js          # IM 数据库操作（复用 user.store 的 db 连接）
├── services/
│   └── chat.service.js        # IM 业务逻辑
├── controllers/
│   └── chat.controller.js     # IM REST API 控制器
├── routes/
│   └── chat.js                # IM REST 路由
├── middleware/
│   └── ws-auth.js             # WebSocket 认证
└── websocket/
    └── index.js               # WebSocket 服务器
public/
└── user-center/
    ├── chat.html              # Web 聊天页面
    └── chat.css               # 聊天页面样式
```

## 九、配置项

配置定义在 `src/config/index.js`，统一管理路径和参数：

```js
{
  dataDir: '/data',              // Docker 环境 | 本地: './data'
  uploadDir: '/data/uploads',    // 上传文件目录
  chat: {
    wsHeartbeatInterval: 30,     // WebSocket 心跳间隔（秒）
    wsMaxConnectionsPerUser: 5,  // 单用户最大连接数
    messageMaxLength: 5000,      // 单条消息最大长度
    uploadMaxSize: 20,           // 文件上传最大大小（MB）
  }
}
```

## 十、认证复用说明

IM 功能**不维护独立的登录认证**，完全复用 `interface.md` 中已有的 JWT 认证体系：

- **REST API 鉴权**：IM 的所有 REST 接口使用标准 Bearer Token 中间件，即登录后拿到的同一个 `accessToken`
- **WebSocket 鉴权**：连接时将 `accessToken` 作为 URL query 参数传入，服务端调用 `jwtService.verifyToken` 验证（与 REST 完全相同的 JWT 验证），检查 token 类型为 `access` 且未被撤销

客户端无需做"IM 登录"，完整流程如下：

```
1. POST /api/auth/login → 获取 accessToken + refreshToken
2. 用 accessToken 调用 IM REST API（会话列表、历史消息、文件上传等）
3. 用同一个 accessToken 连接 WebSocket（ws://host/ws/chat?token=xxx）
4. token 过期后用 refreshToken 刷新（POST /api/auth/refresh），然后用新 token 重连 WebSocket
```

## 十一、大模型生成客户端代码

将 `im-interface.md`（API 契约层）和 `im.md`（架构设计约束）两个文件一起提供给大模型，即可生成完整的客户端代码。可使用以下 prompt：

> 根据 `im-interface.md` 中的 API 规范和 `im.md` 中的架构设计约束，生成一个 [语言/框架] 的 IM 客户端 SDK，包含：认证模块（含加密登录）、WebSocket 连接管理（心跳/重连/多端同步）、REST API 封装、消息收发、离线同步、文件上传。

### 两个文件的分工

| 文件 | 作用 | 大模型依赖程度 |
|------|------|---------------|
| `im-interface.md` | API 契约层：统一响应格式、13 个 REST 接口的完整请求/响应 JSON、5 个数据模型 TypeScript 定义、8 种 WebSocket 事件完整 JSON 示例、认证加密流程、错误码表 | 必需，生成代码的核心依据 |
| `im.md` | 架构背景层：技术选型理由、心跳/重连策略、离线消息同步流程、安全约束、Docker 部署信息、配置参数 | 补充，帮助理解约束和边界条件 |

### 已覆盖的关键信息

1. 统一响应格式 — `{ code: 0, data }` 成功 / `{ code, message }` 错误
2. 认证完整流程 — 获取公钥 → RSA+AES 混合加密登录 → Token 刷新 → Token 过期重连
3. 5 个数据模型 — Message、ConversationListItem、ConversationDetail、User、UploadFile
4. 13 个 REST API — 每个都有请求体示例、字段说明、响应 JSON、错误码表
5. WebSocket 协议 — 4 种客户端消息 + 8 种服务端事件，完整 JSON 示例
6. WebSocket 关闭码 — 4001（认证失败）、4002（连接超限）
7. 心跳保活 — ping/pong 机制，30 秒间隔
8. 离线消息同步 — 用 `after` 参数增量拉取
9. 历史消息分页 — 用 `before` 向上翻页，`limit` 默认 50 最大 200
10. 文件上传 — multipart/form-data、字段名 `file`、MIME 白名单、20MB 限制
11. 消息内容格式 — text/image/file/system 四种类型的 content 格式
12. 速率限制 — WebSocket 每秒 10 条，超限错误消息
13. 安全约束 — 消息最大 5000 字符、单用户最多 5 个连接、权限校验规则
