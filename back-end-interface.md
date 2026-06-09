
## API 接口

| 方法 | 路径 | 认证 | 加密 | 说明 |
|------|------|------|------|------|
| GET | `/api/auth/public-key` | - | - | 获取 RSA 公钥 |
| GET | `/api/auth/sdk-token` | - | - | 获取腾讯会议 SDK Token |
| GET | `/api/auth/id-token` | Bearer Token | - | 获取腾讯会议 ID Token |
| POST | `/api/auth/login` | - | ✅ | 用户登录 |
| POST | `/api/auth/refresh` | - | ✅ | 刷新令牌 |
| POST | `/api/auth/logout` | Bearer Token | - | 登出（撤销 Token） |
| GET | `/api/auth/profile` | Bearer Token | - | 获取用户信息 |
| POST | `/api/auth/change-password` | Bearer Token | - | 修改密码 |

### 响应格式

```json
// 成功
{ "code": 0, "data": { ... } }

// 失败
{ "code": 401, "message": "Invalid credentials" }
```

---

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

请求体需经 RSA + AES 混合加密，受速率限制保护（默认 5 次/分钟）。连续失败 5 次后账户锁定 15 分钟。

**加密前的原始请求体**

```json
{
  "username": "zhangsan",
  "password": "<your-password>"
}
```

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
    "expiresIn": 900,
    "tokenType": "Bearer"
  }
}
```

**失败响应**

```json
// 缺少字段 400
{ "code": 400, "message": "Missing username or password" }

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
    "expiresIn": 900,
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
    "role": "user"
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

**Node.js 客户端加密示例**

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