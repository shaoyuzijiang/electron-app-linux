# 腾讯会议功能 — 客户端 API 接口文档

> 本文档供大模型或开发者生成客户端代码使用，包含完整的请求/响应格式、参数说明和示例。
>
> 相关文档：[meeting.md](./meeting.md)（腾讯会议集成设计方案与架构约束）| [interface.md](./interface.md)（认证/用户/IM API 接口文档）| [calendar-interface.md](./calendar-interface.md)（日程 API，与会议联动）

---

## 一、基础信息

| 项目 | 说明 |
|------|------|
| Base URL | `http://<host>:<port>` |
| 路由前缀 | `/api/wemeet` |
| 认证方式 | JWT Bearer Token（请求头 `Authorization: Bearer <accessToken>`） |
| 内容类型 | `application/json` |
| 签名处理 | 服务端自动完成 HMAC-SHA256 签名，客户端无需关心 |

> **前置条件**：需在环境变量中配置 `WEMEET_SECRET_ID`、`WEMEET_SECRET_KEY`、`WEMEET_APP_ID`、`WEMEET_SDK_ID`（从[腾讯会议开放平台](https://meeting.tencent.com/open-api.html)获取）。

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
  "code": 400,
  "message": "WeMeet API error: ..."
}
```

- `code` 为 HTTP 状态码，`0` 表示成功
- 会议接口的创建者 `userid` 均自动取自当前登录用户，客户端无需传入

---

## 三、接口总览

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/wemeet/meetings` | Bearer Token | 创建会议 |
| PUT | `/api/wemeet/meetings/:meetingId` | Bearer Token | 修改会议 |
| POST | `/api/wemeet/meetings/:meetingId/cancel` | Bearer Token | 取消会议 |
| GET | `/api/wemeet/meetings` | Bearer Token | 查询用户会议列表 |
| GET | `/api/wemeet/meetings/:meetingId` | Bearer Token | 查询会议详情 |
| GET | `/api/wemeet/meetings/:meetingId/participants` | Bearer Token | 获取参会成员 |
| GET | `/api/wemeet/history/meetings` | Bearer Token | 查询已结束会议列表 |
| GET | `/api/wemeet/users/:userid` | Bearer Token | 获取用户详情 |
| GET | `/api/wemeet/records` | Bearer Token | 查询录制列表 |
| GET | `/api/wemeet/records/:recordId/address` | Bearer Token | 获取录制下载地址 |
| GET | `/api/wemeet/webhook` | 签名验证 | 腾讯会议回调 URL 验证（配置事件订阅时验证连通性） |
| POST | `/api/wemeet/webhook` | 签名验证 | 腾讯会议事件回调（会议结束自动置灰卡片、日程同步） |

---

## 四、接口详解

### 1. 创建会议

需要 Bearer Token 认证。服务端自动处理 HMAC-SHA256 签名，创建者 `userid` 自动从当前登录用户的 `username` 获取，无需传入。

> **接口文档**：[腾讯云 - 创建会议](https://cloud.tencent.com/document/product/1095/42417)

**请求**

```bash
curl -X POST http://localhost:3000/api/wemeet/meetings \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "项目周会",
    "type": 0,
    "start_time": "1749540000",
    "end_time": "1749543600",
    "instanceid": 1,
    "password": "123456",
    "settings": {
      "mute_enable_type_join": 2
    }
  }'
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `subject` | string | ✅ | 会议主题，不超过 512 字节 |
| `type` | integer | ✅ | 会议类型：0-预约会议，1-快速会议 |
| `start_time` | string | ✅ | 会议开始时间（秒级时间戳），需大于当前时间 |
| `end_time` | string | ✅ | 会议结束时间（秒级时间戳），需大于开始时间 |
| `instanceid` | integer | ✅ | 用户终端设备类型，默认 1（PC）。0-PSTN, 1-PC, 2-Mac, 3-Android, 4-iOS, 5-Web, 6-iPad, 7-Android Pad, 8-小程序, 10-Linux |
| `meeting_type` | integer | - | 会议模式：0-普通会议（默认），1-周期性会议，5-个人会议号会议 |
| `hosts` | User[] | - | 主持人列表（仅商业版/企业版），如 `[{"userid": "user1"}]` |
| `invitees` | User[] | - | 参会人列表（仅商业版/企业版），限 300 人 |
| `guests` | Guest[] | - | 会议嘉宾列表（不受密码和等候室限制），限 2000 人 |
| `password` | string | - | 会议密码（4-6 位数字） |
| `settings` | object | - | 会议媒体参数配置（见下方 Setting 对象） |
| `recurring_rule` | object | - | 周期性会议配置（`meeting_type=1` 时使用） |
| `enable_live` | boolean | - | 是否开启直播，默认 false |
| `live_config` | object | - | 直播配置 |
| `enable_host_key` | boolean | - | 是否开启主持人密钥，默认 false |
| `host_key` | string | - | 主持人密钥，仅支持 6 位数字 |
| `time_zone` | string | - | 时区（Oracle-TimeZone 标准） |
| `location` | string | - | 会议地点，最长 18 个汉字或 36 个英文字母 |

**Setting 对象**

| 字段 | 类型 | 说明 |
|------|------|------|
| `mute_enable_type_join` | integer | 入会静音选项：0-关闭，1-开启，2-超6人自动开启（默认2） |
| `allow_unmute_self` | boolean | 允许参会者取消静音，默认 true |
| `allow_in_before_host` | boolean | 允许主持人前入会，默认 true |
| `auto_in_waiting_room` | boolean | 开启等候室，默认 false |
| `allow_screen_shared_watermark` | boolean | 屏幕共享水印，默认 false |
| `only_user_join_type` | integer | 入会限制：1-所有成员，2-仅受邀成员，3-仅企业内部 |
| `auto_record_type` | string | 自动录制：none-禁用，local-本地录制，cloud-云录制 |
| `allow_multi_device` | boolean | 允许多端入会 |
| `change_nickname` | integer | 是否允许改名：1-允许（默认），2-不允许 |

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "meeting_info": {
      "meeting_id": "123456789",
      "subject": "项目周会",
      "status": "init",
      "join_url": "https://meeting.tencent.com/dm/r/XXXXXXX",
      "meeting_code": "123-456-789",
      "password": "123456",
      "start_time": "1749540000",
      "end_time": "1749543600",
      "hosts": [{ "userid": "zhangsan" }],
      "invitees": []
    }
  }
}
```

**失败响应**

```json
// 未认证 401
{ "code": 401, "message": "Missing or invalid Authorization header" }

// 缺少必填字段 400
{ "code": 400, "message": "Missing required field: subject" }
{ "code": 400, "message": "Missing required field: type (0-scheduled, 1-instant)" }
{ "code": 400, "message": "Missing required field: start_time (unix timestamp in seconds)" }
{ "code": 400, "message": "Missing required field: end_time (unix timestamp in seconds)" }

// API 凭证未配置 500
{ "code": 500, "message": "WeMeet API credentials not configured (WEMEET_SECRET_ID, WEMEET_SECRET_KEY)" }

// 腾讯会议 API 错误
{ "code": 400, "message": "WeMeet API error: ..." }
```

---

### 2. 修改会议

需要 Bearer Token 认证。仅会议创建者可修改，创建者 `userid` 自动从当前登录用户获取，无需传入。请求体所有字段均为可选，但至少需要传入一项可修改字段。

> **接口文档**：[腾讯云 - 修改会议](https://cloud.tencent.com/document/product/1095/41428)

**请求**

```bash
curl -X PUT http://localhost:3000/api/wemeet/meetings/123456789 \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "项目周会（已调整）",
    "start_time": "1749543600",
    "end_time": "1749547200"
  }'
```

**路径参数**

| 参数 | 说明 |
|------|------|
| `meetingId` | 会议 ID（`meeting_id`，非 `meeting_code`） |

**请求体参数**（均为可选，至少传一项）

| 字段 | 类型 | 说明 |
|------|------|------|
| `subject` | string | 会议主题，不超过 512 字节 |
| `start_time` | string | 会议开始时间，秒级 Unix 时间戳 |
| `end_time` | string | 会议结束时间，秒级 Unix 时间戳 |
| `instanceid` | integer | 终端设备类型，默认 1(PC) |
| `meeting_type` | integer | 0-普通会议(默认) 1-周期性会议 |
| `hosts` | array | 主持人列表 `[{"userid":"user1"}]` |
| `invitees` | array | 参会人列表 `[{"userid":"user2"}]` |
| `password` | string | 会议密码，4-6 位数字 |
| `settings` | object | 会议设置（同创建会议） |
| `time_zone` | string | 时区 |
| `location` | string | 会议地点 |
| `recurring_rule` | object | 周期性会议配置 |

**成功响应** `200`

```json
{
  "code": 0,
  "data": {
    "meeting_number": 1,
    "meeting_info_list": [
      {
        "meeting_id": "123456789",
        "meeting_code": "123-456-789",
        "subject": "项目周会（已调整）",
        "start_time": "1749543600",
        "end_time": "1749547200"
      }
    ]
  }
}
```

**失败响应**

```json
// 未提供任何可修改字段 400
{ "code": 400, "message": "No editable field provided (e.g. subject, start_time, end_time, settings)" }

// API 凭证未配置 500
{ "code": 500, "message": "WeMeet API credentials not configured (WEMEET_SECRET_ID, WEMEET_SECRET_KEY)" }

// 腾讯会议 API 错误（如非创建者、会议不存在等）
{ "code": 400, "message": "WeMeet API error: ..." }
```

---

### 3. 取消会议

需要 Bearer Token 认证。仅会议创建者可取消，创建者 `userid` 自动从当前登录用户获取，无需传入。

> **接口文档**：[腾讯云 - 取消会议](https://cloud.tencent.com/document/product/1095/42422)

**请求**

```bash
curl -X POST http://localhost:3000/api/wemeet/meetings/123456789/cancel \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "reason_code": 1,
    "reason_detail": "会议改期"
  }'
```

**路径参数**

| 参数 | 说明 |
|------|------|
| `meetingId` | 会议 ID（`meeting_id`，非 `meeting_code`） |

**请求体参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reason_code` | integer | - | 取消原因代码，默认 1（可自定义） |
| `reason_detail` | string | - | 详细取消原因描述 |
| `instanceid` | integer | - | 终端设备类型，默认 1(PC) |
| `meeting_type` | integer | - | 0-普通会议(默认) 1-周期性会议 |

**成功响应** `200`（腾讯会议成功时返回空 body）

```json
{
  "code": 0,
  "data": {}
}
```

**失败响应**

```json
// API 凭证未配置 500
{ "code": 500, "message": "WeMeet API credentials not configured (WEMEET_SECRET_ID, WEMEET_SECRET_KEY)" }

// 腾讯会议 API 错误（如非创建者、会议已结束等）
{ "code": 400, "message": "WeMeet API error: ..." }
```

---

### 4. 查询用户会议列表

**请求**

```bash
curl http://localhost:3000/api/wemeet/meetings \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**查询参数**

| 参数 | 说明 |
|------|------|
| `page` | 页码 |
| `page_size` | 每页数量 |

---

### 5. 查询会议详情

```bash
curl http://localhost:3000/api/wemeet/meetings/123456789 \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 6. 查询已结束会议列表

```bash
curl "http://localhost:3000/api/wemeet/history/meetings?page=1&page_size=10" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 7. 获取参会成员

```bash
curl http://localhost:3000/api/wemeet/meetings/123456789/participants \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 8. 获取用户详情

```bash
curl http://localhost:3000/api/wemeet/users/zhangsan \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

> 支持降级机制：优先使用 `WEMEET_ADMIN_USERID` 作为 `operator_id`，失败后自动使用当前登录用户重试。

---

### 9. 查询录制列表

```bash
curl http://localhost:3000/api/wemeet/records \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

> 默认查询最近 24 小时的录制记录。

---

### 10. 获取录制下载地址

```bash
curl http://localhost:3000/api/wemeet/records/record123/address \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 11. 腾讯会议 Webhook 回调

无需 JWT 认证，使用腾讯会议回调签名验证。用于接收腾讯会议事件通知（如会议结束），自动置灰 IM 会话中对应的会议邀请卡片消息，并同步日程。

回调服务需同时支持 GET 和 POST 两种请求方式：
- **GET** — URL 验证（配置事件订阅时验证连通性）
- **POST** — 事件回调（接收会议事件通知）

> **前置条件**：
> - 需在环境变量中配置 `WEMEET_WEBHOOK_TOKEN`（在腾讯会议开放平台配置事件订阅时生成，用于签名验证）
> - 需在环境变量中配置 `WEMEET_WEBHOOK_ENCRYPT_KEY`（EncodingAESKey，43 位字符串，用于消息加密）

**签名算法**（GET 和 POST 通用）：

```
signature = SHA1(sort([token, timestamp, nonce, data]))
```

将 `token`、`timestamp`、`nonce`、`data` 四个参数按字典序排序后拼接，再 SHA1 加密。

#### GET 请求 — URL 验证

```bash
GET /api/wemeet/webhook?check_str=<Base64编码的AES加密数据>
Header: timestamp: <时间戳>
Header: nonce: <随机数>
Header: signature: <SHA1(sort([token, timestamp, nonce, check_str]))>
```

服务端收到 GET 请求后：
1. 验证 `signature` 签名（`data` 为 `check_str` 参数值）
2. 使用 AES-256-CBC 解密 `check_str`（AESKey = Base64Decode(EncodingAESKey + "=")，IV = AESKey 前 16 字节，PKCS#7 填充）
3. **3 秒内**响应解密后的明文字符串（不带引号、换行符）

**响应**（解密明文，纯文本）：

```
decrypted-plaintext-string
```

#### POST 请求 — 事件回调

```bash
POST /api/wemeet/webhook
Content-Type: application/json
Header: timestamp: <时间戳>
Header: nonce: <随机数>
Header: signature: <SHA1(sort([token, timestamp, nonce, data]))>
```

**请求体**（加密模式，`data` 为 Base64 编码的 AES 加密数据）：

```json
{
  "data": "Base64编码的AES加密数据"
}
```

服务端收到 POST 请求后：
1. 验证 `signature` 签名（`data` 为请求体中的 `data` 字段值）
2. 使用 AES-256-CBC 解密 `data` 字段，得到明文 JSON（含 `event`、`payload` 等字段）
3. 处理事件

**会议结束事件（`meeting.end`）：**

解密后的明文 JSON：

```json
{
  "event": "meeting.end",
  "payload": [
    {
      "meeting_info": {
        "meeting_id": "123456789",
        "meeting_code": "121274901"
      }
    }
  ]
}
```

服务端验证签名并解密后，自动查找 IM 会话中包含该 `meeting_code` 且未置灰的卡片消息，更新为置灰状态，并通过 WebSocket 推送 `message_update` 事件给在线成员。

#### 日程同步事件（`meeting.created` / `meeting.updated` / `meeting.canceled`）

服务端在收到会议创建/修改/取消事件时，会自动同步日程表：
- `meeting.created`：若该 `meeting_id` 尚无活动日程，则以 `meeting_info.creator.userid`（且在本系统内存在）为组织者创建新日程；如已存在活动日程则刷新会议信息（幂等）。**快速会议（`meeting_create_mode=1`）跳过，不创建日程。**
- `meeting.updated`：查找该 `meeting_id` 对应的活动日程并更新；找不到则降级走 `meeting.created` 流程。
- `meeting.canceled`：软删除（`status='cancelled'`）该 `meeting_id` 对应的日程。

> 事件名以腾讯会议开放平台官方文档为准（使用过去式：`created` / `updated` / `canceled`），无 `meeting.delete` 事件。

解密后的明文 JSON 示例（`meeting.created`）：

```json
{
  "event": "meeting.created",
  "trace_id": "e7aa65dd-f7e6-4b62-912c-2035173b34a9",
  "payload": [
    {
      "operate_time": 1609313201465,
      "operator": { "userid": "user_001", "user_name": "张三" },
      "meeting_info": {
        "meeting_id": "13339451618278424869",
        "meeting_code": "445999969",
        "subject": "项目周会",
        "creator": { "userid": "user_001", "user_name": "张三" },
        "meeting_type": 0,
        "meeting_create_mode": 0,
        "meeting_create_from": 1,
        "start_time": 1608522626,
        "end_time": 1609415039
      }
    }
  ]
}
```

关键字段说明：
- `meeting_type`：0:一次性会议，1:周期性会议，2:微信专属，4:rooms 投屏，5:个人会议号（个人会议号不触发 cancel/updated 事件）
- `meeting_create_mode`：0:普通会议，1:快速会议。**快速会议（=1）跳过日程同步**
- `start_time` / `end_time`：秒级 Unix 时间戳
- `creator.userid`：组织者 ID，必须是本系统已存在用户，否则跳过该日程创建
- `hosts` / `invitees`：**`meeting.created` 事件 payload 中**实际**始终不携带这两个字段**（不仅是"可选"）。本服务在收到事件后会自动调用腾讯会议"查询会议详情"接口（`GET /v1/meetings/{meetingId}`，封装在 `wemeetService.queryMeetingUsers` 中）拉取 `hosts` / `current_hosts` / `current_co_hosts` / `participants` 来补全被邀请人；查询失败时按"只有 organizer"降级，后续可通过 `meeting.updated` 事件重新同步。补全结果中不在本系统的用户会被自动过滤。

**成功响应**（纯文本，不带引号、换行）：

```
successfully received callback
```

> 腾讯会议要求 HTTP 200 且响应内容为 `successfully received callback`，否则会重试（1分钟、3分钟、6分钟各一次）。
>
> **异步响应说明**（v1.1+）：本服务在签名/解密校验通过后**立即**返回 200，业务处理（数据库写入、WS 推送、查询接口补全）通过 `setImmediate` 异步执行，避免因业务耗时触发上述重试。**校验失败（解密/签名错误）仍返回 401，由腾讯会议自动重试；业务执行失败不触发重试**，需人工介入。

**失败响应：**

```
// 签名验证失败 401
Callback signature verification failed

// 解密失败 401
Callback data decryption failed: ...
```

> **安全说明**：Webhook 端点在 JWT 中间件之前注册，不经过 JWT 认证。使用 `SHA1(sort([token, timestamp, nonce, data]))` 验证 `signature` 头，防止伪造请求。事件数据使用 AES-256-CBC 加密传输，防止中间人窃听。置灰操作幂等：已置灰的消息不会重复处理。
