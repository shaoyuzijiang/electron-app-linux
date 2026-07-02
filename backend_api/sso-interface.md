# Web SSO 接口参考（APP WebView 免登）

> 完整设计见 [sso.md](./sso.md)。本文档聚焦于 4 个接口的请求/响应细节、错误码表、cURL 示例。

## 接口总览

| 方法 | 路径 | 认证 | 用途 |
|------|------|------|------|
| POST | `/api/auth/sso/ticket` | Bearer Access Token | 颁发一次性 SSO Ticket（60s 有效） |
| GET  | `/sso/redirect` | ticket（query 一次性） | 同源兑换：302 + Set-Cookie `sso_session` |
| POST | `/api/auth/sso/exchange` | HMAC `X-Web-Server-Key` | 跨源兑换：返回用户信息 |
| GET  | `/api/admin/sso-tickets` | Admin Token | 审计查询：分页 + 多维筛选 |

## 受众白名单（audience）

| audience | pathPrefix | requireAdmin |
| --- | --- | --- |
| `web-user-center:chat` | `/user-center/chat` | false |
| `web-user-center:organization` | `/user-center/organization-management` | false |
| `web-user-center:role` | `/user-center/role-management` | true |

---

## 1. 颁发 Ticket：`POST /api/auth/sso/ticket`

### 请求

```bash
curl -X POST https://host/api/auth/sso/ticket \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "audience": "web-user-center:chat",
    "target":   "/user-center/chat",
    "nonce":    "可选，16-64 字符，5 分钟内同 user+aud 不允许重复"
  }'
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `audience` | ✅ | 必须在白名单 |
| `target` | ✅ | 必须以该 audience 的 pathPrefix 开头 |
| `nonce` | ❌ | APP 端可携带，服务端按 `userId+audience` 桶 5 分钟去重 |

### 成功响应 `200`

```json
{
  "code": 0,
  "data": {
    "ticket":    "v1.eyJhbGciOiJIUzI1NiIsImtpZCI6InNzby10aWNrZXQtdjEifQ.eyJ0eXBlIjoic3NvLXRpY2tldCIsImp0aSI6IjB4Li4uIiwic3ViIjoidXNlckAxIiwiYXVkIjoid2ViLXVzZXItY2VudGVyOmNoYXQiLCJ0YXJnZXQiOiIvdXNlci1jZW50ZXIvY2hhdCIsImlhdCI6MTcyMDAwMDAwMCwiZXhwIjoxNzIwMDAwMDYwfQ.signature",
    "jti":       "0e8b2c1f-4d3a-4b9e-9c2a-1f7d6e5a4b3c",
    "expiresIn": 60,
    "expiresAt": 1720000060000
  }
}
```

### 失败响应

| HTTP | code | 场景 | 排查 |
| --- | --- | --- | --- |
| 400 | 400 | 缺 `audience` / `target` | 请求体字段缺失 |
| 400 | 400 | `audience` 不在白名单 | 改用 § audience 表中的取值 |
| 400 | 400 | `target` 不在该 audience 的 pathPrefix 下 | 确保 `target.startsWith(pathPrefix)` |
| 400 | 400 | `nonce` 在 5 分钟内已使用（user+aud 维度） | 换一个 nonce 或不传 |
| 401 | 401 | Access Token 缺失 / 失效 | 重新走 `/api/auth/login` 拿 token |
| 403 | 403 | `audience.requireAdmin=true` 但当前用户非 admin | 用管理员账号重试 |
| 404 | 404 | SSO 全局开关关闭（`SSO_ENABLED=false`） | 配置项开启 |
| 429 | 429 | 单用户颁发频次超限（默认 10/min） | 退避后重试，参考响应头 `Retry-After` |

> 错误响应 body 形如 `{ "code": 401, "message": "..." }`，统一文案，**不回显**白名单内容或票据内部信息。

---

## 2. 同源兑换：`GET /sso/redirect`

### 请求

```
GET /sso/redirect?ticket=<TICKET>
```

参数仅 `ticket`。**不接受** `target` 参数（target 已在 ticket 中签名绑定）。

### 行为

| 场景 | 响应 |
| --- | --- |
| 正常 | `302` + `Set-Cookie: sso_session=...; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=7200` + `Location: <target>` |
| ticket 签名错误 | `302 Location: /user-center/login?reason=invalid_ticket` |
| ticket 过期（>60s） | `302 Location: /user-center/login?reason=expired_ticket` |
| 二次消费（已 used） | `302 Location: /user-center/login?reason=invalid_ticket` |
| audience/target 不在白名单 | `302 Location: /user-center/login?reason=invalid_ticket` |
| `SSO_ENABLED=false` | `302 Location: /user-center/login?reason=invalid_ticket` |

> `?reason=xxx` 中 `xxx` 由服务端白名单常量（`invalid_ticket` / `expired_ticket` / `cookie_required`），登录页 JS 据此显示提示。

### Web Session 行为

- Cookie 名：`sso_session`
- HttpOnly；Secure（生产）；SameSite=Strict；Path=/
- 有效期：默认 2 小时（`SSO_SESSION_TTL_MS`，毫秒）
- 用户登出（`POST /api/auth/logout`）会**同时清理**该用户所有 web session + 当前 Cookie
- 进程内 Map<sessionId, SessionInfo>，重启即丢（生产单实例 OK；多实例需 Redis 化）

### 浏览器调用

直接 `<a href>` 或 `window.location.href` 跳转即可：

```js
window.location.href = `https://host/sso/redirect?ticket=${encodeURIComponent(ticket)}`;
```

> 不需要也无法在前端带 `Authorization` 头。**所有跨源**的 `fetch` 调用都依赖 Cookie（`credentials: 'include'`）。

---

## 3. 跨源兑换：`POST /api/auth/sso/exchange`

> 由持有 AppSecret 的**跨源 Web 服务器**（非浏览器）调用。

### 请求头

```
POST /api/auth/sso/exchange
Content-Type: application/json
X-Web-Server-Key: t=<unix_ts>,nonce=<16+>,sign=<hex>
X-Audience: <audience>
```

### 请求体

```json
{
  "ticket":   "v1.<jwt>",
  "serverId": "marketing-h5"
}
```

### `X-Web-Server-Key` 计算

```
canonical = "<method>\n<path>\n<audience>\n<unix_ts>\n<nonce>\n<sha256_hex(body)>"
sign      = HMAC-SHA256( appSecret, canonical )   // hex 小写
```

| 头字段 | 说明 |
| --- | --- |
| `t` | Unix 秒，**5 分钟**有效（`SSO_HMAC_WINDOW_SEC`，默认 300） |
| `nonce` | 16-128 字符（`[A-Za-z0-9_-]`），按 `serverId + 时间桶` 一次性 |
| `sign` | 上述公式的 hex 小写 64 字符 |

### 成功响应 `200`

```json
{
  "code": 0,
  "data": {
    "user": {
      "id":     "user@example.com",
      "email":  "user@example.com",
      "name":   "张三",
      "deptId": "root",
      "role":   "user"
    },
    "audience":  "web-user-center:chat",
    "expiresAt": 1720000060000
  }
}
```

`expiresAt` 是该 ticket 的原始过期时间；跨源服务器可作为自建 session 的过期时间。

### 失败响应

| HTTP | code | 场景 | 排查 |
| --- | --- | --- | --- |
| 400 | 400 | header 格式错误 / 缺 `X-Audience` / 缺 `serverId` | 检查 4 个字段的格式 |
| 401 | 401 | `t` 超出 5 分钟窗 | 检查本机时钟是否同步 |
| 401 | 401 | nonce 在同一时间桶内重复 | 换一个 nonce |
| 401 | 401 | `sign` 不匹配 | 校验 appSecret、audience、body 哈希 |
| 403 | 403 | `serverId` 不在 `config.sso.crossOriginWebServers` 白名单 | 配置项添加 |
| 403 | 403 | `X-Audience` 不在该 `serverId.allowedAudiences` 中 | 调整 server 配置或 audience |
| 404 | 404 | ticket 不存在 | 检查 ticket 来源 / 是否被重置 |
| 409 | 409 | ticket 已使用 / 已过期 | 重新申请新 ticket |
| 500 | 500 | DB 异常 | 服务端日志 |

### curl 示例

```bash
SECRET='<appSecret>'
TS=$(date +%s)
NONCE=$(openssl rand -hex 16)
BODY='{"ticket":"v1.xxx","serverId":"marketing-h5"}'
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 -hex | awk '{print $2}')
CANON="POST\n/api/auth/sso/exchange\nweb-user-center:chat\n${TS}\n${NONCE}\n${BODY_HASH}"
SIG=$(printf '%b' "$CANON" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

curl -X POST https://host/api/auth/sso/exchange \
  -H "Content-Type: application/json" \
  -H "X-Web-Server-Key: t=${TS},nonce=${NONCE},sign=${SIG}" \
  -H "X-Audience: web-user-center:chat" \
  -d "$BODY"
```

### 配置项：跨源服务器列表

环境变量 `SSO_CROSS_ORIGIN_SERVERS`（JSON 字符串）：

```bash
SSO_CROSS_ORIGIN_SERVERS='[
  {"serverId":"marketing-h5","appSecret":"<32+字节随机hex>","allowedAudiences":["web-user-center:chat"]},
  {"serverId":"ops-portal","appSecret":"<另一组>","allowedAudiences":["web-user-center:chat","web-user-center:organization"]}
]'
```

修改后**重启服务**生效。

---

## 4. 审计查询：`GET /api/admin/sso-tickets`

> 仅 admin / superadmin 角色可访问。

### 请求

```bash
curl "https://host/api/admin/sso-tickets?page=1&pageSize=20&action=failure&result=failure" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

| Query 字段 | 类型 | 说明 |
| --- | --- | --- |
| `page` | int | 默认 1 |
| `pageSize` | int | 默认 20 |
| `userId` | string | 过滤用户 ID |
| `audience` | string | 过滤 audience |
| `action` | string | `issue` / `redirect` / `exchange` |
| `result` | string | `success` / `failure` |
| `from` | int (ms) | 起始时间（Unix 毫秒） |
| `to` | int (ms) | 截止时间（Unix 毫秒） |

### 成功响应

```json
{
  "code": 0,
  "data": {
    "total":    321,
    "page":     1,
    "pageSize": 20,
    "items": [
      {
        "id":        9001,
        "jti":       "0e8b2c1f-...",
        "userId":    "user@example.com",
        "userEmail": "张三",
        "audience":  "web-user-center:chat",
        "target":    "/user-center/chat",
        "action":    "issue",
        "result":    "success",
        "errorCode": null,
        "ip":        "10.0.0.5",
        "ua":        "WeMeetSDK/2.1.0 (iOS; iOS 17.5)",
        "createdAt": 1720000000000
      }
    ]
  }
}
```

`errorCode` 可能值（仅 `result=failure` 时有值）：

| errorCode | 含义 |
| --- | --- |
| `signature_invalid` | ticket 签名错误 |
| `replay_or_expired` | 二次消费 / 过期 |
| `audience_invalid` | audience 不在白名单 |
| `audience_mismatch` | 跨源兑换时 X-Audience 与 ticket 内 aud 不一致 |
| `rate_limited` | 颁发限流 |

### 失败响应

| HTTP | code | 场景 |
| --- | --- | --- |
| 401 | 401 | 缺 / 错 Admin Token |
| 403 | 403 | Token 持有者非 admin / superadmin |

---

## 错误码总表

| code | HTTP | 含义 |
| --- | --- | --- |
| 0 | 200 | 成功 |
| 400 | 400 | 缺参数 / 参数格式错误 |
| 401 | 401 | 未认证 / 签名错 / 时间窗超 |
| 403 | 403 | 越权（如非 admin 申请 admin-only audience） |
| 404 | 404 | SSO 未启用 / ticket 不存在 |
| 409 | 409 | ticket 已用 / 已过期（仅 exchange） |
| 429 | 429 | 颁发限流 |
| 500 | 500 | 服务端异常（DB 等） |

---

## 环境变量清单

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SSO_ENABLED` | `true` | 全局开关；`false` 时颁发接口直接 404 |
| `SSO_TICKET_SECRET` | `dev-sso-ticket-secret-change-me` | **生产必显式设置**；HS256 签名密钥（≥32 字节随机） |
| `SSO_TICKET_TTL_MS` | `60000` | Ticket 有效期（毫秒），60s |
| `SSO_SESSION_TTL_MS` | `7200000` | Web Session 有效期（毫秒），2h |
| `SSO_ISSUE_RATE_WINDOW_MS` | `60000` | 颁发限流窗口 |
| `SSO_ISSUE_RATE_MAX` | `10` | 单用户窗口内最大颁发次数 |
| `SSO_HMAC_WINDOW_SEC` | `300` | 跨源 HMAC 时间窗（秒） |
| `SSO_AUDIT_RETENTION_DAYS` | `90` | 审计日志保留天数 |
| `SSO_TICKET_RETENTION_DAYS` | `7` | ticket 行保留天数 |
| `SSO_CROSS_ORIGIN_SERVERS` | `[]` | 跨源服务器 JSON 配置 |

---

## 安全要点速查

- Ticket 一次有效，60s TTL，原子 `UPDATE WHERE used=0` 防重放
- audience 白名单 + target 路径前缀校验
- 跨源 HMAC-SHA256，5 分钟时间窗 + nonce 一次性
- Web Session Cookie：`HttpOnly; Secure; SameSite=Strict`
- 错误响应统一文案，不回显内部信息
- 登出自动清理 web session
- 失败审计可按 userId/audience/action/result 维度筛选
