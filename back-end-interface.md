## API 接口

| 方法 | 路径 | 认证 | 加密 | 说明 |
|------|------|------|------|------|
| GET | `/api/auth/public-key` | - | - | 获取 RSA 公钥 |
| POST | `/api/auth/login` | - | ✅ | 用户登录 |
| POST | `/api/auth/refresh` | - | ✅ | 刷新令牌 |
| GET | `/api/auth/profile` | Bearer Token | - | 获取用户信息 |

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

### 2. 用户登录

请求体需经 RSA + AES 混合加密，受速率限制保护。

**加密前的原始请求体**

```json
{
  "username": "zhangsan",
  "password": "password123"
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

// 解密失败 400
{ "code": 400, "message": "Decryption failed" }

// 重放请求 400
{ "code": 400, "message": "Invalid or reused nonce" }

// 请求过期 400
{ "code": 400, "message": "Request expired or invalid timestamp" }

// 速率超限 429
{ "code": 429, "message": "Too many requests, please try again later" }
```

---

### 3. 刷新令牌

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

### 4. 获取用户信息

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

// Token 无效 401
{ "code": 401, "message": "Invalid token" }

// 使用了 Refresh Token 而非 Access Token 401
{ "code": 401, "message": "Invalid token type, access token required" }
```

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