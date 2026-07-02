# APP WebView 免登打开 Web 页面（Web SSO）

> 状态：设计稿（待实施）
> 适用范围：腾讯会议 SDK 内嵌的 WebView 通过一次性票据免登访问本系统提供的所有 Web 页面
> 设计原则：**Token 不进 URL**、**一次性消费**、**可审计**、**短 TTL**

---

## 1. 背景与痛点

APP（腾讯会议 SDK）登录用户希望在自带的 WebView 中直接打开系统内的 Web 页面（聊天、组织架构、角色管理等），避免重复输入密码。

### 1.1 已有方案及其问题

直接拼接 `?access_token=...` 到 URL 是最容易想到的方案，但会引入多个严重风险：

| 风险 | 触发场景 | 后果 |
| --- | --- | --- |
| 服务端 access log 落地 | 反向代理 / 网关记录完整 URL | Token 进入日志，长期留存 |
| Referer 泄漏 | 页面内嵌 iframe / 外链 / 第三方资源 | Token 跨域泄露 |
| 浏览器历史 / 截图 | WebView 历史栈、用户截屏 | 用户侧 Token 残留 |
| Token 复用 | 攻击者从任一渠道拿到 URL 即可使用 | 任意时点冒充用户 |
| 权限范围失控 | URL 里携带的是完整 Access Token | 可调用所有 `/api/*`，不止当前页所需 |

### 1.2 设计目标

1. APP 用 **Access Token** 申请一个**一次性、短期、可审计的票据**（下文称 **SSO Ticket**）。
2. WebView 通过**两种安全路径**之一把 Ticket 兑换为 Web 会话（**同源** 走 302 Cookie 注入；**跨源** 走 HMAC 鉴权 + 同步返回用户信息）。
3. 真正的 **Access Token 永不进入 URL、Referer、access log**。
4. Ticket 一次有效、60 秒内必须兑换，过期 / 已用 / 非法一律失败。
5. 所有 issue / exchange / redirect 操作全程留痕，可在管理后台审计。

---

## 2. 架构概览

```
┌────────────────┐                              ┌────────────────────────┐
│   APP / SDK    │                              │   Auth Server (本系统)  │
│  (登录态用户)   │                              │  Koa + better-sqlite3  │
└────────┬───────┘                              │                        │
         │ ① POST /api/auth/sso/ticket          │  ┌──────────────────┐  │
         │   Authorization: Bearer <Access>     │  │  sso_tickets     │  │
         │   { audience, target }               │  │  sso_audit_logs  │  │
         │ ───────────────────────────────────► │  │  web_sessions    │  │
         │                                      │  └──────────────────┘  │
         │ ◄────────────────────────────────────│                        │
         │ { ticket, jti, expiresIn: 60 }       └────────┬───────────────┘
         │                                                  │
         │ ② WebView.loadUrl(                              │
         │     https://host/sso/redirect?ticket=xxx        │
         │   )                                              │
         │ ────────────────────────────────────────────────►│
         │                                                  │ ③ 服务端校验 + 原子消费
         │                                                  │    (UPDATE ... WHERE used=0)
         │                                                  │
         │ ◄─── 302 ───────────────────────────────────────│
         │     Set-Cookie: sso_session=...; HttpOnly; Secure│
         │     Location: /user-center/chat                  │
         │                                                  │
         │ ④ WebView 加载目标页                              │
         │    页面 JS 读不到 Cookie（HttpOnly），             │
         │    但 AJAX 请求会自动带 Cookie，                  │
         │    因此 `/api/auth/profile` 拿到当前用户          │
```

跨源场景（管理后台拆部署 / 第三方 H5）走 `POST /api/auth/sso/exchange`：
- 由**该跨源服务器**而非浏览器持有 AppSecret。
- 携带 `X-Web-Server-Key`（HMAC-SHA256 签名，5 分钟时间窗 + 一次性 nonce）。
- 服务端核签后**同步返回**用户基本信息，跨源服务器再用自有的 session 机制签发自己域的 Cookie。

---

## 3. 受保护页面清单（本期范围）

> 范围确认：**`public/user-center/` 下所有需要登录才能访问的页面全部纳入**。
> `login.html` / `register.html` 不在本期范围（前者本身无登录态，后者是注册入口且已有 UA 拦截）。

| 页面 | URL Path | audience 取值 | 是否需要登录 | 是否纳入 SSO |
| --- | --- | --- | --- | --- |
| 即时通讯 | `/user-center/chat` | `web-user-center:chat` | 是 | ✅ |
| 组织架构管理 | `/user-center` | `web-user-center:organization` | 是（部分菜单需管理员） | ✅ |
| 角色管理 | `/user-center?tab=roles` | `web-user-center:organization` | 是（仅管理员，前端按角色控制展示） | ✅ |
| 登录页 | `/user-center/login` | — | 否 | ❌ |
| 注册页 | `/user-center/register` | — | 否（UA 拦截） | ❌ |

**audience 命名规范**：`web-user-center:<子模块>`，预留扩展位（后续接外部 H5、运营后台等只需新增条目）。

> **跨页跳转**：同源情况下用户在 chat 页内点击"组织架构"链接直接走 `location.href`，**不需要**重新签发 Ticket（302 落下的 `sso_session` Cookie 还在）。如目标页是**新浏览器实例**或**新 WebView 容器**，则需 APP 重新申请 Ticket。

---

## 4. API 详细设计

### 4.1 颁发 Ticket：`POST /api/auth/sso/ticket`

APP 用已登录用户的 Access Token 调用，颁发一个一次性 SSO Ticket。

#### 请求

```
POST /api/auth/sso/ticket
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "audience": "web-user-center:chat",
  "target":   "/user-center/chat",
  "nonce":    "可选 16-64 字符防重放，由 APP 生成"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `audience` | ✅ | 受众标识，必须命中白名单（见 §3 表） |
| `target` | ✅ | 兑换后回跳的目标路径，必须以该 audience 对应的前缀开头 |
| `nonce` | ❌ | APP 端可携带，服务端会在 5 分钟窗口内拒绝重复 nonce（按 user_id + audience 维度） |

#### 成功响应 `200`

```json
{
  "code": 0,
  "data": {
    "ticket":     "v1.eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiJ1dWlkIiwic3ViIjoxMjM0NSwiYXVkIjoid2ViLXVzZXItY2VudGVyOmNoYXQiLCJ0YXJnZXQiOiIvdXNlci1jZW50ZXIvY2hhdCIsImlhdCI6MTcyMDAwMDAwMCwiZXhwIjoxNzIwMDAwMDYwfQ.signature",
    "jti":        "0e8b2c1f-4d3a-4b9e-9c2a-1f7d6e5a4b3c",
    "expiresIn":  60,
    "expiresAt":  1720000060000
  }
}
```

#### 失败响应

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | 400 | 缺少 audience / target |
| 400 | 400 | audience 未在白名单 |
| 400 | 400 | target 不在该 audience 允许的路径前缀下 |
| 401 | 401 | Access Token 缺失 / 失效 |
| 429 | 429 | 单用户颁发频次超限（默认 10/min） |
| 500 | 500 | DB 异常（仅在 ticket 持久化失败时） |

> 错误文案统一为 `"Invalid request"` / `"Ticket issuance rate limit exceeded"` 等，**不回显内部信息**（如具体白名单内容、target 长度等）。

#### 安全要点

- 颁发频次限流：**`10 / minute / user`**（滑动窗口）。
- Ticket 本身是 HS256 JWT，payload 含 `jti` / `sub`(user_id) / `aud` / `target` / `iat` / `exp`。
- 密钥复用现有 `JWT_ACCESS_SECRET` 即可（无需新增密钥），并加入 `kid="sso-ticket-v1"` 头。
- 服务端**先**写 `sso_tickets` 行（含 status=active），**再**返回 ticket——保证**任何返回给 APP 的 ticket 都已经在 DB 可被消费**。

---

### 4.2 同源兑换（302 + Cookie）：`GET /sso/redirect`

WebView 直接打开此 URL，把 Ticket 兑换成本域 Session Cookie，并 302 到目标页。

#### 请求

```
GET /sso/redirect?ticket=v1.<jwt>
```

参数仅 `ticket` 一个。**不接收** `target` 参数——target 已经在 ticket 内签名绑定，防止覆盖攻击。

#### 行为流程

1. 校验 `ticket` 签名（HS256）→ 解析 `jti / sub / aud / target / exp`。
2. 在 `sso_tickets` 表上执行**原子消费**：
   ```sql
   UPDATE sso_tickets
   SET used = 1, used_at = ?, used_ip = ?
   WHERE jti = ? AND used = 0 AND expires_at > ?;
   ```
   - 影响行数 = 0 → ticket 不存在 / 已用 / 已过期 → 302 到 `login.html?reason=invalid_ticket`。
3. 校验 `aud` 命中白名单 + `target` 路径前缀合法。
4. 写 `sso_audit_logs`（action=`redirect`, result=`success`）。
5. 生成 `web_session_id`（32 字节随机，base64url 编码）→ 写入内存 `web_sessions: Map<jti, { uid, aud, target, ip, ua, exp }>`。
6. 设置 Cookie：
   ```
   Set-Cookie: sso_session=<id>; Path=/; HttpOnly; Secure; SameSite=Strict;
               Max-Age=7200
   ```
7. 302 → `Location: <target>`（target 必须以 `/` 开头且在白名单前缀内）。

#### 失败响应

| 场景 | 处理 |
| --- | --- |
| 签名错误 / 过期 | 302 → `/user-center/login?reason=invalid_ticket` |
| 原子消费失败 | 302 → `/user-center/login?reason=invalid_ticket` |
| audience / target 不在白名单 | 302 → `/user-center/login?reason=invalid_ticket` |
| 浏览器禁用 Cookie | 302 → `/user-center/login?reason=cookie_required`，登录页 JS 检测 `?reason=cookie_required` 后给提示 |

> 登录页 `?reason=xxx` 的 reason 字符串由后端**白名单常量**（`invalid_ticket` / `expired_ticket` / `cookie_required`），不接收外部传参。

#### Web Session 设计

- 存于**进程内** `Map<sessionId, SessionInfo>`（生产部署单实例 OK；如需多实例可换 Redis，本期不引入新依赖）。
- SessionInfo 字段：`{ uid, aud, target, ip, ua, exp }`。
- 有效期 **2 小时**（与现有 Access Token 同档），可在配置项调整。
- 现有 `POST /api/auth/logout` 在撤销 Access Token 时，**同时**遍历并删除该用户的 web session（同 `sub` 全部失效）。

---

### 4.3 跨源兑换（HMAC 鉴权）：`POST /api/auth/sso/exchange`

跨源 Web 服务器（持有 AppSecret）调用此接口，把 Ticket 兑换成用户基本信息，**不再发 Cookie**（Cookie 由跨源服务器自己签发）。

#### 请求

```
POST /api/auth/sso/exchange
Content-Type: application/json
X-Web-Server-Key: t=<unix_ts>,nonce=<16+>,sign=<hex>
X-Audience: web-user-center:chat

{
  "ticket":  "v1.<jwt>",
  "serverId": "marketing-h5"   // 跨源服务器标识，写入审计
}
```

#### `X-Web-Server-Key` 计算

```
canonical = "<method>\n<path>\n<audience>\n<unix_ts>\n<nonce>\n<sha256(body)>"
sign      = HMAC-SHA256( appSecret, canonical )
```

| 头字段 | 说明 |
| --- | --- |
| `t` | Unix 秒，**5 分钟**有效 |
| `nonce` | 16+ 字符，服务端按 `serverId + t` 桶内 5 分钟去重 |
| `sign` | 上述公式的 hex 小写 |

服务端在 `config.crossOriginWebServers` 中维护受信任的跨源服务器列表（`serverId → { appSecret, allowedAudiences }`），与请求里的 `serverId` / `X-Audience` 比对。

#### 成功响应 `200`

```json
{
  "code": 0,
  "data": {
    "user": {
      "id":     12345,
      "email":  "zhangsan@example.com",
      "name":   "张三",
      "deptId": 7
    },
    "audience": "web-user-center:chat",
    "expiresAt": 1720003660000
  }
}
```

#### 失败响应

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | 400 | header 格式错误 / 缺字段 |
| 401 | 401 | 时间戳超出 5 分钟 |
| 401 | 401 | nonce 重复 |
| 401 | 401 | 签名不匹配 |
| 403 | 403 | serverId 未在信任列表 / audience 不匹配 |
| 404 | 404 | ticket 不存在 |
| 409 | 409 | ticket 已使用 / 已过期 |

#### 安全要点

- **AppSecret 永不进 WebView**，仅跨源服务端持有。
- 跨源服务器拿到的 `user` 字段**不包含密码哈希、Access Token、Refresh Token**，仅含展示 / 鉴权所需基本信息。
- 跨源服务器应把 `expiresAt` 用作自身 session 的过期时间，并在到期前提示用户重新走免登。

---

### 4.4 审计查询：`GET /api/admin/sso-tickets`

管理员查询 SSO 票据的颁发 / 消费记录。

#### 请求

```
GET /api/admin/sso-tickets?page=1&pageSize=20
    &userId=12345
    &audience=web-user-center:chat
    &action=issue|exchange|redirect
    &result=success|failure
    &from=2026-07-01T00:00:00Z
    &to=2026-07-02T00:00:00Z
```

需 Admin Token（走现有 `requireAdmin` 中间件）。

#### 成功响应

```json
{
  "code": 0,
  "data": {
    "total":  321,
    "page":   1,
    "pageSize": 20,
    "items": [
      {
        "id":         9001,
        "jti":        "0e8b2c1f-...",
        "userId":     12345,
        "userEmail":  "zhangsan@example.com",
        "audience":   "web-user-center:chat",
        "target":     "/user-center/chat",
        "action":     "issue",
        "result":     "success",
        "ip":         "10.0.0.5",
        "ua":         "WeMeetSDK/2.1.0 (iOS; iOS 17.5)",
        "createdAt":  1720000000000
      }
    ]
  }
}
```

#### 权限与脱敏

- 仅 `admin` 角色可访问。
- 错误响应不返回 ticket 完整内容，只返回 `jti` 摘要（已存的就是 jti，不需要截断）。
- `result=failure` 的条目额外带 `errorCode`（`expired` / `replay` / `signature_invalid` / `audience_invalid` / `target_invalid` / `rate_limited`），便于管理员分类统计。

---

## 5. 数据模型

### 5.1 `sso_tickets`

```sql
CREATE TABLE sso_tickets (
  jti         TEXT PRIMARY KEY,                 -- UUID
  user_id     INTEGER NOT NULL,
  audience    TEXT    NOT NULL,                 -- 'web-user-center:chat' 等
  target      TEXT    NOT NULL,                 -- '/user-center/chat' 等
  used        INTEGER NOT NULL DEFAULT 0,       -- 0=未用, 1=已用
  used_at     INTEGER,                          -- unix ms
  used_ip     TEXT,                             -- 兑换时的 IP
  expires_at  INTEGER NOT NULL,                 -- unix ms（iat + 60s）
  created_at  INTEGER NOT NULL,                 -- unix ms
  created_ip  TEXT NOT NULL,                    -- 颁发时的 IP
  created_ua  TEXT                              -- 颁发时的 UA（截断到 256）
);
CREATE INDEX idx_sso_tickets_user ON sso_tickets(user_id, created_at);
CREATE INDEX idx_sso_tickets_expires ON sso_tickets(expires_at);
```

由 `src/store/sso.store.js` 管理，**复用**项目里现有的 `better-sqlite3` + `db.prepare()` 同步模式（参考 `chat.store.js`）。

### 5.2 `sso_audit_logs`

```sql
CREATE TABLE sso_audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  jti         TEXT,                             -- 关联 tickets.jti（不建 FK，便于清理）
  user_id     INTEGER,                          -- 颁发 / 消费时的 user_id
  audience    TEXT,                             -- 受众
  target      TEXT,                             -- 目标路径
  action      TEXT NOT NULL,                    -- 'issue' | 'exchange' | 'redirect'
  result      TEXT NOT NULL,                    -- 'success' | 'failure'
  error_code  TEXT,                             -- 失败原因（成功为 NULL）
  ip          TEXT,
  ua          TEXT,                             -- 截断 256
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_sso_audit_user ON sso_audit_logs(user_id, created_at);
CREATE INDEX idx_sso_audit_action ON sso_audit_logs(action, created_at);
```

> **保留策略**：7 天内的 ticket 详情随时可查（用于排障），7 天以上的 `sso_tickets` 行可定期清理（用 `expires_at < ?`），但 `sso_audit_logs` 默认保留 90 天（可配置）。

### 5.3 `web_sessions`（内存，不入 DB）

```js
// 进程内 Map；重启即丢，符合 Web Session 短期特性
const webSessions = new Map(); // sessionId -> SessionInfo
```

---

## 6. 配置项（环境变量）

> 全部加在 `src/config/index.js`，沿用现有 `config.xxx` 风格。

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `config.sso.enabled` | `true` | 全局开关；false 时 `/api/auth/sso/ticket` 直接 404 |
| `config.sso.ticketTtlMs` | `60000` | Ticket 有效期（毫秒），60s |
| `config.sso.issueRateLimit.windowMs` | `60000` | 颁发限流窗口 |
| `config.sso.issueRateLimit.max` | `10` | 单用户窗口内最大颁发次数 |
| `config.sso.sessionTtlMs` | `7200000` | Web Session 有效期，2h |
| `config.sso.audiences` | `[{ id, pathPrefix, requireAdmin }]` | 白名单，详见 §3 |
| `config.sso.crossOriginWebServers` | `[]` | 跨源服务器列表 |
| `config.sso.auditRetentionDays` | `90` | 审计日志保留天数 |
| `config.sso.ticketRetentionDays` | `7` | ticket 行保留天数 |

`config.sso.audiences` 初始值：

```js
[
  { id: 'web-user-center:chat',          pathPrefix: '/user-center/chat',          requireAdmin: false },
  { id: 'web-user-center:organization',  pathPrefix: '/user-center',               requireAdmin: false },
]
```

> 角色管理已并入 `web-user-center:organization` 页面（`?tab=roles` 内嵌面板），不在 `audiences` 中单独签发；访问控制由前端按 `currentUser.role === 'superadmin'` 决定是否展示入口。

---

## 7. 文件级改造清单

### 7.1 新增

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/store/sso.store.js` | ~120 | `sso_tickets` / `sso_audit_logs` 表 + 原子消费 + 查询 |
| `src/services/sso.service.js` | ~200 | 颁发 / 兑换（重）/ 兑换（跨源） 业务逻辑 |
| `src/controllers/sso.controller.js` | ~80 | HTTP 层，参数校验 + 调 service |
| `src/middleware/ssoRateLimit.js` | ~50 | 单用户颁发频次限流（滑动窗口） |
| `src/middleware/webServerHmac.js` | ~120 | 跨源 HMAC 鉴权 |
| `src/middleware/webSession.js` | ~80 | 校验 `sso_session` Cookie，把 `ctx.state.webSession` 挂上 |
| `sso.md` | — | 本文档 |
| `sso-interface.md` | — | 接口详细参考（curl 示例、错误码表） |

### 7.2 修改

| 文件 | 改动 |
| --- | --- |
| `src/services/jwt.service.js` | 新增 `signSsoTicket({jti, userId, audience, target, iat, exp})` + `verifySsoTicket(token)`，复用 `JWT_ACCESS_SECRET` |
| `src/middleware/jwt.js` | 把 `webSession` 中间件挂到 `requireAuth` 之后（Cookie 优先于 Bearer：优先 Cookie，没有再退回 Authorization 头，便于 API 调用） |
| `src/routes/auth.js` | 新增 `POST /api/auth/sso/ticket`（`requireAuth`） |
| `src/routes/sso.js`（新文件，与 auth 路由同级） | 挂 `GET /sso/redirect` + `POST /api/auth/sso/exchange` + `GET /api/admin/sso-tickets` |
| `src/routes/admin.js` | 引入 `GET /api/admin/sso-tickets`（`requireAdmin`） |
| `src/controllers/auth.controller.js` | 在 `logout()` 中遍历删除该用户 web session |
| `src/config/index.js` | 新增 `config.sso.*` 块 |
| `src/app.js` | 注册 `webSession` 中间件（早于业务路由），加载新路由 |
| `public/user-center/chat.html` | 顶部新增 12 行：从 `URL?reason=xxx` 提示；从 `localStorage.sso_inflight` 拉取目标页（防御性，无也可） |
| `public/user-center/index.html` | 同上（内嵌 `?tab=roles` 角色管理面板，由前端按 `currentUser.role` 决定是否展示） |
| `public/admin.html` | 左侧菜单新增"Web SSO 票据" Tab；分页 / 多维筛选 |

**预期代码量**：服务端 ~650 行新增 + ~30 行修改；前端 ~180 行新增 + ~30 行修改。

---

## 8. 实施步骤（CRAFT 模式）

按依赖顺序执行，每步可独立编译 / 启动 / 自测。

| Step | 范围 | 验证 |
| --- | --- | --- |
| 1 | `sso.store.js` 建表 + 单元函数（issue/consume/listAudit） | `node -e "require('./src/store/sso.store').init()"` |
| 2 | `config/index.js` 加 `sso.*` 块 | 启动不报错 |
| 3 | `jwt.service.js` 加 `signSsoTicket` / `verifySsoTicket` | 单元测试往返 |
| 4 | `webSession` 中间件 + `requireAuth` 改造（Bearer ∪ Cookie） | curl 带 Cookie 调 `/api/auth/profile` |
| 5 | `ssoRateLimit` + `webServerHmac` + `sso.service` + `sso.controller` + 路由 | curl 全链路 |
| 6 | `chat.html` / `index.html` 顶部加 `?reason=xxx` 提示 + `?tab=roles` 管理员兜底 | 浏览器打开看 |
| 7 | `admin.html` 加 SSO 票据 Tab（分页 / 筛选） | 浏览器打开看 |
| 8 | `sso-interface.md` 写接口参考 | 文档校对 |
| 9 | §10 测试用例自测 + 集成测试 | 全部 PASS |

---

## 9. 时序图

### 9.1 同源流程（以 `chat.html` 为例）

```
APP                    Auth Server                WebView / 浏览器
 │                         │                            │
 │──① POST /sso/ticket ──►│                            │
 │   (Bearer AT,           │                            │
 │    aud=…:chat,          │                            │
 │    target=/…/chat)      │                            │
 │                         │  写 sso_tickets(active)    │
 │                         │  写 sso_audit(issue, ok)   │
 │◄── { ticket, 60s } ────│                            │
 │                         │                            │
 │──② loadUrl(/sso/redirect?ticket=…) ────────────────►│
 │                                                   Auth Server
 │                         │  验签 + 原子消费           │
 │                         │  写 sso_audit(redirect,ok) │
 │                         │  建 webSession             │
 │◄── 302 + Set-Cookie ──│                            │
 │    Location: /user-center/chat                       │
 │                         │                            │
 │──③ GET /user-center/chat ─────────────────────────►│
 │   Cookie: sso_session=…                              │
 │                         │  webSession 中间件校验     │
 │                         │  静态文件返回 chat.html    │
 │◄── 200 chat.html ──────────────────────────────────│
 │                                                   浏览器
 │──④ GET /api/auth/profile ────────────────────────►│
 │   Cookie: sso_session=…                              │
 │                         │  webSession → uid          │
 │◄── { user } ──────────────────────────────────────│
```

### 9.2 跨源流程（以运营 H5 为例）

```
APP          Auth Server         跨源 H5 Server       H5 浏览器
 │                │                     │                │
 │──① /sso/ticket ►│                    │                │
 │◄── ticket ────│                    │                │
 │                │                    │                │
 │──② POST /sso/exchange (HMAC) ────►│                │
 │                │  验签 + 原子消费    │                │
 │                │  写 sso_audit      │                │
 │                │   (exchange,ok)   │                │
 │◄── { user } ──│                    │                │
 │                │                    │                │
 │──③ 跳跨源 URL ────────────────────────────────────►│
 │                │                    │                │
 │  (跨源服务器用自有的 session 机制把 user 写进自家 Cookie)  │
```

---

## 10. 测试用例（验收清单）

### 10.1 颁发

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | 未带 Bearer | 401 |
| 2 | Bearer 过期 | 401 |
| 3 | 缺 `audience` | 400 |
| 4 | `audience=foo:bar` 不在白名单 | 400 |
| 5 | `target=/admin/x` 不在 audience 前缀下 | 400 |
| 6 | 普通用户请求 `audience=…:role` | 403 |
| 7 | 正常请求 | 200，60s 内有效 |
| 8 | 1 分钟内颁发 11 次 | 第 11 次 429 |
| 9 | 同 nonce（同 user+aud） 5 分钟内重用 | 400 `nonce_reused` |

### 10.2 同源兑换

| # | 用例 | 期望 |
| --- | --- | --- |
| 10 | ticket 签名错误 | 302 → `login?reason=invalid_ticket` |
| 11 | ticket 过期（>60s） | 302 → `login?reason=expired_ticket` |
| 12 | ticket 二次兑换 | 第二次 302 → `login?reason=invalid_ticket`，`sso_audit_logs` 多一条 `result=failure,error_code=replay` |
| 13 | 浏览器禁用 Cookie | 302 → `login?reason=cookie_required` |
| 14 | 正常流程 | 302 → target，Cookie 写入，`sso_audit_logs` 多一条 `redirect,success` |
| 15 | 拿到 Cookie 后调用 `/api/auth/profile` | 200，返回当前用户 |

### 10.3 跨源兑换

| # | 用例 | 期望 |
| --- | --- | --- |
| 16 | 缺 `X-Web-Server-Key` | 400 |
| 17 | 时间戳 > 5 分钟 | 401 |
| 18 | 签名错误 | 401 |
| 19 | nonce 重复 | 401 |
| 20 | `serverId` 未在信任列表 | 403 |
| 21 | `X-Audience` 与 serverId 允许列表不匹配 | 403 |
| 22 | 正常 | 200，返回 user + audience + expiresAt |

### 10.4 审计

| # | 用例 | 期望 |
| --- | --- | --- |
| 23 | 管理员分页查询 | 返回 total + items |
| 24 | 按 userId 过滤 | 仅返回该用户记录 |
| 25 | 按 `action=failure` 过滤 | 失败记录带 `errorCode` |
| 26 | 非管理员调用 | 401 |

### 10.5 端到端

| # | 用例 | 期望 |
| --- | --- | --- |
| 27 | APP 拿 AT 申请 chat Ticket → 浏览器打开 → 看到登录用户 | 成功 |
| 28 | 同上，但浏览器禁用 Cookie | 跳登录页 + 提示开启 Cookie |
| 29 | 同一 Ticket 在两台设备同时打开 | 后者跳登录页 |
| 30 | 退出登录后再次使用旧 Cookie 调 `/api/auth/profile` | 401，session 已清 |

---

## 11. 风险与对策

| 风险 | 对策 |
| --- | --- |
| WebView 不支持 Set-Cookie | APP 调用 Ticket 接口前先 `CookieManager.setAcceptCookie(true)`；服务端在 302 失败时回退到 `?reason=cookie_required` 让登录页提示 |
| Ticket 颁发瞬间 DB 故障 | ticket 入库后再返回给 APP；任何 DB 错误都返回 5xx，不发半成品 ticket |
| 进程内 `web_sessions` 重启即丢 | 接受（2h 短期 session，重启影响小）；后续如需多实例部署，迁移到 Redis（本期不引入） |
| 旧 Token 泄漏 | 旧 Access Token 仍然有效——本方案不替代现有的撤销机制；用户登出需 APP 主动调 `/api/auth/logout` |
| 管理员误发 audit 日志过大 | 90 天自动清理（`config.sso.auditRetentionDays`），保留 7 天的 ticket 行 |
| 跨源 AppSecret 泄漏 | AppSecret 仅存于跨源服务端；HMAC 时间窗 5 分钟 + nonce 一次性降低被重放窗口；定期轮换通过配置项热更新 |
| 攻击者刷 `/sso/redirect?ticket=xxx` 暴力猜 ticket | ticket 长度 ≥ 128 bit 且 HS256 签名，无签名钥无法伪造；颁发限流 + 消费原子 UPDATE 防重放 |
| `?tab=roles` 角色面板误开放 | 前端 `switchToRoles()` / `updateRoleNavVisibility()` 双重判断 `currentUser.role === 'superadmin'`，否则回退到默认页 |

---

## 12. 不在本期范围

- 与第三方 IdP（OIDC / SAML）对接。
- 多实例部署下的 web session 共享（Redis 化）。
- 设备指纹 / 客户端 IP 绑定到 ticket。
- APP 端 SDK 的具体实现（仅提供 §3 API 契约 + curl 示例）。
- 短信 / 邮箱二次验证。

---

## 附录 A：cURL 示例

### A.1 颁发

```bash
TOKEN="<ACCESS_TOKEN>"
curl -X POST http://localhost:3000/api/auth/sso/ticket \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience":"web-user-center:chat","target":"/user-center/chat"}'
```

### A.2 同源兑换

```bash
# 浏览器直接打开即可，无需 curl
open "http://localhost:3000/sso/redirect?ticket=$TICKET"
```

### A.3 跨源兑换

```bash
TS=$(date +%s)
NONCE=$(openssl rand -hex 16)
BODY='{"ticket":"v1.xxx","serverId":"marketing-h5"}'
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 -binary | xxd -p -c 256)
CANON="POST\n/api/auth/sso/exchange\nweb-user-center:chat\n${TS}\n${NONCE}\n${BODY_HASH}"
SIG=$(printf '%b' "$CANON" | openssl dgst -sha256 -hmac "$APP_SECRET" -hex | awk '{print $2}')

curl -X POST http://localhost:3000/api/auth/sso/exchange \
  -H "Content-Type: application/json" \
  -H "X-Web-Server-Key: t=${TS},nonce=${NONCE},sign=${SIG}" \
  -H "X-Audience: web-user-center:chat" \
  -d "$BODY"
```

### A.4 审计查询

```bash
ADMIN_TOKEN="<ADMIN_TOKEN>"
curl "http://localhost:3000/api/admin/sso-tickets?page=1&pageSize=20&action=failure" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 附录 B：客户端集成示意（APP 侧伪代码）

> **说明**：本节不是本系统的实现，仅为 APP 端开发者对接的契约示例。

```kotlin
// Android / iOS WebView 容器
fun openWebPage(accessToken: String, audience: String, target: String) {
    // 1. 申请 Ticket
    val resp = http.post(
        url = "https://host/api/auth/sso/ticket",
        headers = mapOf("Authorization" to "Bearer $accessToken"),
        body = mapOf("audience" to audience, "target" to target),
    )
    val ticket = resp.data.ticket

    // 2. 打开 WebView，跳到 /sso/redirect
    webView.loadUrl("https://host/sso/redirect?ticket=$ticket")
}
```

> **不要**把 Access Token 直接拼到 URL；**不要**在 WebView 里手写 `Authorization` 头后再 `loadUrl`。
