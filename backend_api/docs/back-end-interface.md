# API 接口文档

## 接口总览

### 认证接口

| 方法 | 路径 | 认证 | 加密 | 说明 |
|------|------|------|------|------|
| GET | `/api/healthcheck` | - | - | 健康检查 |
| GET | `/api/auth/public-key` | - | - | 获取 RSA 公钥 |
| GET | `/api/auth/sdk-token` | - | - | 获取腾讯会议 SDK Token |
| GET | `/api/auth/id-token` | Bearer Token | - | 获取腾讯会议 ID Token |
| POST | `/api/auth/login` | - | ✅ | 用户登录 |
| POST | `/api/auth/refresh` | - | ✅ | 刷新令牌 |
| POST | `/api/auth/logout` | Bearer Token | - | 登出（撤销 Token） |
| GET | `/api/auth/profile` | Bearer Token | - | 获取用户信息 |
| POST | `/api/auth/change-password` | Bearer Token | - | 修改密码 |
| POST | `/api/auth/register` | - | - | 用户自助注册 |

### 管理员接口

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/admin/login` | - | 管理员登录 |
| GET | `/api/admin/login-history` | Admin Token | 查询登录历史 |
| GET | `/api/admin/settings/registration-ua` | Admin Token | 读取注册页允许的 UA 关键字列表 |
| PUT | `/api/admin/settings/registration-ua` | Admin Token | 更新注册页允许的 UA 关键字列表 |

### 腾讯会议接口

> 腾讯会议相关接口（创建/修改/取消/查询/录制/Webhook）完整 API 文档请参阅 [meeting-interface.md](./meeting-interface.md)；集成设计方案见 [meeting.md](./meeting.md)。

### IM 即时通讯接口

> IM 即时通讯的完整 API 文档请参阅 [im-interface.md](./im-interface.md)，设计方案请参阅 [im.md](./im.md)。

### 组织架构与通讯录接口

> 组织架构与通讯录的完整 API 文档请参阅 [contacts-interface.md](./contacts-interface.md)；设计方案见 [contacts.md](./contacts.md)。

### Web SSO 免登接口（APP WebView）

> APP 通过一次性 SSO Ticket 免登打开本系统的 Web 页面（IM 聊天 / 组织架构 / 角色管理），完整设计见 [sso.md](./sso.md)；接口详细参考见 [sso-interface.md](./sso-interface.md)。

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/auth/sso/ticket` | Bearer Token | 颁发一次性 SSO Ticket（60s 有效） |
| GET  | `/sso/redirect` | ticket 一次性 | 同源兑换：302 + Set-Cookie `sso_session` |
| POST | `/api/auth/sso/exchange` | HMAC (`X-Web-Server-Key`) | 跨源兑换：返回用户信息 |
| GET  | `/api/admin/sso-tickets` | Admin Token | 审计查询：分页 / 多维筛选 |

### 响应格式

```json
// 成功
{ "code": 0, "data": { ... } }

// 失败
{ "code": 401, "message": "Invalid credentials" }
```

---

## 认证接口详解

### 0. 健康检查

无需认证，无需加密。用于 Docker 健康检查和 entrypoint 自愈监控。该接口在日志中间件之前注册，不会记录访问日志。

**请求**

```bash
curl http://localhost:3000/api/healthcheck
```

**响应**

```json
{
  "code": 0,
  "data": {
    "status": "ok"
  }
}
```

### 1. 获取 RSA 公钥

无需认证，无需加密。

**请求**

```bash
curl http://localhost:3000/api/auth/public-key
```

**响应**

```json
{
  "code": 0,
  "data": {
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----\n"
  }
}
```

> 后续加密请求需使用此公钥加密 AES 密钥。

---

### 2. 获取腾讯会议 SDK Token

无需认证，无需加密。根据腾讯会议 SDK 鉴权规范，由服务端使用 HS256 算法签发 JWT Token。

> **前置条件**：需在环境变量中配置 `SDK_ID` 和 `SDK_SECRET`（从腾讯会议 SDK 配置中获取）。

**请求**

```bash
curl http://localhost:3000/api/auth/sdk-token
```

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "sdkId": "your-sdk-id",
    "sdkToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 1748936400
  }
}
```

**失败响应**

```json
// SDK 未配置 500
{ "code": 500, "message": "SDK_ID and SDK_SECRET must be configured in environment variables" }
```

> **SDK Token 说明**：
> - 使用 HS256 (HMAC-SHA256) 签名，密钥为 `SDK_SECRET`
> - Payload 包含 `aud`（固定值 `"Tencent Meeting"`）、`iss`（SDK ID）、`iat`、`exp`
> - `expiresIn` 为 Token 过期时间的 Unix 时间戳（秒），有效期默认 30 天（可通过 `SDK_TOKEN_EXPIRES_IN` 环境变量配置）
> - 客户端获取后用于 SDK 初始化，初始化时仅做本地校验，真正验证在登录时进行

---

### 3. 获取腾讯会议 ID Token

需要 Bearer Token 认证，无需加密。根据腾讯会议 SDK 鉴权规范，由服务端使用 RS256 算法签发 JWT Token。

> **前置条件**：需在环境变量中配置 `SDK_ID`，并将腾讯会议 RSA 私钥文件放置在 `sso_key/private.pem`。

**请求**

```bash
curl http://localhost:3000/api/auth/id-token \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "idToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 1748936300,
    "ssoUrl": "https://test-idp.id.meeting.qq.com/cidp/custom/ai-xxx/ai-yyy?id_token="
  }
}
```

> `ssoUrl` 仅在配置了 `SDK_SSO_URL_PREFIX` 环境变量时返回，规则为 `SSO_URL前缀 + ID Token`。

**失败响应**

```json
// 未认证 401
{ "code": 401, "message": "Missing or invalid Authorization header" }

// SDK 未配置或私钥缺失 500
{ "code": 500, "message": "SDK_ID must be configured and sso_key/private.pem must exist" }
```

> **ID Token 说明**：
> - 使用 RS256 (RSA-SHA256) 签名，密钥为腾讯侧提供的 RSA 私钥文件
> - Payload 包含 `sub`（用户 ID，对应腾讯会议的 userId）、`iss`（SDK ID）、`name`（用户显示名称）、`iat`、`exp`
> - `expiresIn` 为 Token 过期时间的 Unix 时间戳（秒），有效期默认 5 分钟（可通过 `SDK_ID_TOKEN_EXPIRES_IN` 环境变量配置）
> - 客户端获取后与 SSO_URL 前缀拼接成完整 SSO_URL，用于 SDK 登录

---

### 4. 用户登录

请求体需经 RSA + AES 混合加密，受速率限制保护（默认 5 次/分钟）。连续失败 5 次后账户锁定 15 分钟。登录成功后自动记录登录历史（IP、客户端版本、客户端类型）。

**加密前的原始请求体**

```json
{
  "email": "zhangsan@example.com",
  "password": "<your-password>",
  "clientVersion": "2.1.0",
  "clientType": "android"
}
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | string | ✅ | 邮箱地址 |
| `password` | string | ✅ | 密码 |
| `clientVersion` | string | - | 客户端版本号（如 `"2.1.0"`），可选；也支持通过 Header `X-Client-Version` 传入 |
| `clientType` | string | - | 客户端类型（如 `web`、`android`、`ios`、`desktop`），可选；也支持通过 Header `X-Client-Type` 传入 |
| `clientOs` | string | - | 操作系统版本（如 `iOS 17.5`、`Android 14`、`Windows 11`），可选；也支持通过 Header `X-Client-OS` 传入 |

**加密后的请求体**

```json
{
  "encryptedKey": "eHl6...（Base64 编码，RSA-OAEP-SHA256 加密的 aesKey+iv）",
  "ciphertext": "YWJj...（Base64 编码，AES-256-CBC 加密的原始请求体）",
  "nonce": "a1b2c3d4e5f6",
  "timestamp": 1748936400000
}
```

**请求**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "encryptedKey": "<RSA 加密的 AES 密钥>",
    "ciphertext": "<AES 加密的请求体>",
    "nonce": "a1b2c3d4e5f6",
    "timestamp": 1748936400000
  }'
```

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 7200,
    "tokenType": "Bearer"
  }
}
```

**失败响应**

```json
// 缺少字段 400
{ "code": 400, "message": "Missing email or password" }

// 凭证错误 401
{ "code": 401, "message": "Invalid credentials" }

// 账户锁定 429
{ "code": 429, "message": "Account temporarily locked due to too many failed attempts, please try again later" }

// 解密失败 400
{ "code": 400, "message": "Decryption failed" }

// nonce/timestamp 缺失 400
{ "code": 400, "message": "Missing nonce or timestamp in encrypted request" }

// 重放请求 400
{ "code": 400, "message": "Invalid or reused nonce" }

// 请求过期 400
{ "code": 400, "message": "Request expired or invalid timestamp" }

// 速率超限 429
{ "code": 429, "message": "Too many requests, please try again later" }
```

---

### 5. 刷新令牌

请求体需经 RSA + AES 混合加密，受速率限制保护。旧 Refresh Token 使用后即加入黑名单，响应返回新的 Token 对。

**加密前的原始请求体**

```json
{
  "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**请求**

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "encryptedKey": "<RSA 加密的 AES 密钥>",
    "ciphertext": "<AES 加密的请求体>",
    "nonce": "x9y8z7w6v5u4",
    "timestamp": 1748936400000
  }'
```

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...(新 Access Token)",
    "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...(新 Refresh Token)",
    "expiresIn": 7200,
    "tokenType": "Bearer"
  }
}
```

**失败响应**

```json
// 缺少 refreshToken 400
{ "code": 400, "message": "Missing refreshToken" }

// Token 无效或过期 401
{ "code": 401, "message": "Invalid or expired refresh token" }

// Token 类型错误 401
{ "code": 401, "message": "Invalid token type" }

// Token 已被撤销 401（此时该用户所有 Refresh Token 已被吊销）
{ "code": 401, "message": "Refresh token has been revoked" }
```

> **安全机制**：如果已撤销的 Refresh Token 被再次使用，服务器判定为 Token 被盗，自动撤销该用户所有 Refresh Token。

---

### 6. 登出

需要 Bearer Token 认证。撤销当前 Access Token，可选同时撤销 Refresh Token。

**请求**

```bash
# 仅撤销 Access Token
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."

# 同时撤销 Refresh Token
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."}'
```

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "message": "Logged out successfully"
  }
}
```

**失败响应**

```json
// Token 已被撤销 401
{ "code": 401, "message": "Token has been revoked" }

// Token 过期 401
{ "code": 401, "message": "Token expired" }
```

---

### 7. 获取用户信息

需要 Bearer Token 认证，无需加密。

**请求**

```bash
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "id": "user_001",
    "username": "zhangsan",
    "role": "user",
    "departmentId": "tech",
    "departmentName": "技术部"
  }
}
```

**失败响应**

```json
// 缺少 Authorization 头 401
{ "code": 401, "message": "Missing or invalid Authorization header" }

// Token 过期 401
{ "code": 401, "message": "Token expired" }

// Token 已被撤销 401
{ "code": 401, "message": "Token has been revoked" }

// Token 无效 401
{ "code": 401, "message": "Invalid token" }

// 使用了 Refresh Token 而非 Access Token 401
{ "code": 401, "message": "Invalid token type, access token required" }
```

---

### 8. 修改密码

需要 Bearer Token 认证，无需加密。需提供当前密码和新密码，密码修改成功后自动撤销该用户所有 Refresh Token（其他设备需重新登录）。

**请求**

```bash
curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "oldPassword": "OldPass123",
    "newPassword": "NewPass456"
  }'
```

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "message": "Password changed successfully"
  }
}
```

**失败响应**

```json
// 缺少字段 400
{ "code": 400, "message": "Missing oldPassword or newPassword" }

// 旧密码错误 401
{ "code": 401, "message": "Current password is incorrect" }

// 新密码强度不足 400
{ "code": 400, "message": "Password must be at least 8 characters" }
{ "code": 400, "message": "Password must contain at least one uppercase letter" }
{ "code": 400, "message": "Password must contain at least one lowercase letter" }
{ "code": 400, "message": "Password must contain at least one digit" }
```

> **安全说明**：新密码需满足强度要求（≥8 位，含大写字母、小写字母和数字）。密码修改成功后，该用户所有 Refresh Token 将被撤销，其他设备上的会话将失效，需重新登录。

---

### 9. 用户自助注册

无需认证，无需加密。用户通过注册页面自助创建临时账号，注册成功后登录信息（邮箱和初始密码）自动发送至登记邮箱。受速率限制保护。

**请求**

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "张三",
    "email": "zhangsan@example.com",
    "phone": "13800138000"
  }'
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | ❌ | 姓名，2-32个字符（支持中文、字母、数字、下划线）。留空时使用邮箱前缀作为展示名，姓名重复不阻止注册 |
| `email` | string | ✅ | 邮箱（同时作为用户ID和登录账号） |
| `phone` | string | ✅ | 手机号，11位国内手机号 |

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "message": "注册成功，登录信息已发送至您的邮箱",
    "emailSent": true
  }
}
```

**失败响应**

```json
// 缺少必填项 400
{ "code": 400, "message": "邮箱和手机号为必填项" }

// 姓名格式错误 400
{ "code": 400, "message": "姓名必须为2-32个字符（支持中文、字母、数字、下划线）" }

// 邮箱格式错误 400
{ "code": 400, "message": "邮箱格式不正确" }

// 手机号格式错误 400
{ "code": 400, "message": "手机号格式不正确" }

// 客户端 UA 不在白名单 403
{ "code": 403, "message": "当前客户端不被支持" }

// 邮箱已被注册 409
{ "code": 409, "message": "该邮箱已被注册" }

// 手机号已被注册 409
{ "code": 409, "message": "该手机号已被注册" }

// 速率超限 429
{ "code": 429, "message": "Too many requests, please try again later" }
```

> **说明**：
> - 注册用户自动归入"临时账号"（tempDep）部门，默认有效期为1天，到期后自动清理
> - 有效期仅管理员可在管理后台修改
> - 用户ID与邮箱保持一致
> - 注册成功后系统自动生成随机密码，并通过邮件发送至登记邮箱
> - 注册时同步创建腾讯会议账号（需配置腾讯会议相关环境变量，失败不影响注册）
> - 清理过期账号时同步删除腾讯会议账号
> - **UA 白名单校验（服务端兜底）**：注册时校验 `User-Agent` 请求头是否包含管理员配置的任一关键字（默认 `WeMeetSDK`，不区分大小写、子串匹配）。不在白名单时仅返回 403 + `当前客户端不被支持`，**不回显 `allowed` 列表与 `currentUA`**，避免被匿名嗅探后针对性伪造 UA 绕过；白名单由管理员通过 `GET/PUT /api/admin/settings/registration-ua` 维护（最多 50 个、每个 ≤ 64 字符，仅管理员可读可写）

---

## 管理员接口详解

### 10. 管理员登录

无需认证，请求体不走加密通道（仅限 HTTPS 使用）。受速率限制保护。连续失败 5 次后账户锁定 15 分钟。仅 `admin` 或 `superadmin` 角色可登录。登录成功后自动记录登录历史（IP、客户端版本、客户端类型）。

**请求**

```bash
# 邮箱登录
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "your-password", "clientVersion": "1.0.0", "clientType": "web"}'

# 用户ID登录
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin", "password": "your-password"}'
```

> `email` 字段既可传入邮箱地址，也可传入用户ID。服务端通过是否包含 `@` 判断登录方式。

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | string | ✅ | 邮箱地址或用户ID |
| `password` | string | ✅ | 密码 |
| `clientVersion` | string | - | 客户端版本号，可选；也支持 Header `X-Client-Version` |
| `clientType` | string | - | 客户端类型，可选；也支持 Header `X-Client-Type` |
| `clientOs` | string | - | 操作系统版本，可选；也支持 Header `X-Client-OS` |

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 7200,
    "tokenType": "Bearer",
    "role": "admin",
    "username": "admin",
    "userId": "admin",
    "email": "admin@example.com"
  }
}
```

**失败响应**

```json
// 缺少字段 400
{ "code": 400, "message": "Missing email or password" }

// 凭证错误 401
{ "code": 401, "message": "Invalid credentials" }

// 非管理员 403
{ "code": 403, "message": "Admin access required" }

// 账户锁定 429
{ "code": 429, "message": "Account temporarily locked, please try again later" }
```

---

### 11. 查询登录历史

需要管理员 Bearer Token 认证。查询用户的登录历史记录（含 IP、客户端版本、客户端类型），支持分页和按用户ID筛选。

**请求**

```bash
# 查询全部登录历史
curl "http://localhost:3000/api/admin/login-history?page=1&pageSize=20" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."

# 按用户ID筛选
curl "http://localhost:3000/api/admin/login-history?userId=zhangsan@example.com&page=1&pageSize=20" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | string | - | 按用户ID筛选，不传则返回全部 |
| `page` | integer | - | 页码，从 1 开始，默认 1 |
| `pageSize` | integer | - | 每页数量，默认 50 |

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 1,
        "user_id": "zhangsan@example.com",
        "username": "张三",
        "ip": "192.168.1.100",
        "client_version": "2.1.0",
        "client_type": "android",
        "client_os": "Android 14",
        "success": 1,
        "login_at": "2026-06-26 16:30:00"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

**响应字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | integer | 记录ID |
| `user_id` | string | 登录用户ID |
| `username` | string | 用户名 |
| `ip` | string | 客户端IP地址 |
| `location` | string | IP地理位置（如 `中国/北京`），异步回填，刚登录时可能为空 |
| `client_version` | string | 客户端版本号 |
| `client_type` | string | 客户端类型（web/android/ios/desktop等） |
| `client_os` | string | 操作系统版本（如 `iOS 17.5`、`Android 14`） |
| `success` | integer | 登录结果，1=成功，0=失败 |
| `login_at` | string | 登录时间 |

> **说明**：登录历史在每次登录成功时自动记录。`client_version` 和 `client_type` 来自客户端请求体或 `X-Client-Version` / `X-Client-Type` Header，`ip` 由服务端从反向代理头（`X-Forwarded-For`）自动获取。可按用户ID筛选查看特定用户的登录记录。

### 12. 读取注册页允许的 UA 关键字

- **路径**：`GET /api/admin/settings/registration-ua`
- **认证**：Admin Token
- **响应**：
  ```json
  {
    "code": 0,
    "data": {
      "allowed": ["WeMeetSDK"]
    }
  }
  ```

### 13. 更新注册页允许的 UA 关键字

- **路径**：`PUT /api/admin/settings/registration-ua`
- **认证**：Admin Token
- **请求体**：
  ```json
  {
    "allowed": ["WeMeetSDK", "MyApp"]
  }
  ```
- **参数说明**：
  - `allowed` (string[])：允许的 UA 关键字列表，最多 50 个，每个不超过 64 字符；服务端会自动去重、忽略空行。
  - 匹配规则：注册页加载时校验 `navigator.userAgent` 中是否包含任一关键字（不区分大小写、子串匹配），未命中则显示拦截提示。
- **响应**：
  ```json
  {
    "code": 0,
    "data": {
      "allowed": ["WeMeetSDK", "MyApp"],
      "message": "注册页 UA 允许列表已更新"
    }
  }
  ```
- **错误码**：
  - `400`：`allowed must be an array of strings` / `最多支持 50 个关键字` / `每个关键字必须为字符串且长度不超过 64`

---

## 加密机制

### 请求加密流程详解

1. 调用 `GET /api/auth/public-key` 获取 RSA 公钥
2. 客户端生成随机 AES-256 密钥 (32 字节) 和 IV (16 字节)
3. 用 AES-256-CBC 加密请求体 JSON → `ciphertext` (Base64)
4. 拼接 `aesKey(32字节) + iv(16字节)`，用 RSA-OAEP-SHA256 公钥加密 → `encryptedKey` (Base64)
5. 生成随机 `nonce` 和当前 `timestamp`（毫秒）
6. 发送请求：

```json
{
  "encryptedKey": "<Base64 编码的 RSA 加密 AES 密钥>",
  "ciphertext": "<Base64 编码的 AES 加密请求体>",
  "nonce": "<随机字符串，防重放>",
  "timestamp": "<毫秒时间戳>"
}
```

> **注意**：`nonce` 和 `timestamp` 为必填字段，缺失时请求将被拒绝。

### Node.js 客户端加密示例

```javascript
const crypto = require('crypto');

async function encryptRequest(publicKeyPem, payload) {
  // 1. 生成 AES 密钥和 IV
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);

  // 2. AES-256-CBC 加密请求体
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]).toString('base64');

  // 3. RSA-OAEP 加密 aesKey + iv
  const encryptedKey = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.concat([aesKey, iv]),
  ).toString('base64');

  // 4. 生成 nonce 和 timestamp
  const nonce = crypto.randomBytes(12).toString('hex');
  const timestamp = Date.now();

  return { encryptedKey, ciphertext, nonce, timestamp };
}
```
