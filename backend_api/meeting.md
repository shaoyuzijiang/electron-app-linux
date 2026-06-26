# 腾讯会议集成设计方案

## 一、概述

基于现有 Koa.js + SQLite 架构，封装腾讯会议（WeMeet）开放平台 REST API，为客户端提供统一的会议管理能力（创建/修改/取消/查询/录制），并通过 Webhook 事件订阅实现会议与本系统日程、IM 卡片的双向同步。

### 设计目标

| 目标 | 说明 |
|------|------|
| 签名透明 | 服务端统一处理 HMAC-SHA256 签名，客户端只需 JWT 认证 |
| 身份安全 | 会议操作的 `userid` 强制取自当前登录用户，禁止伪造他人身份 |
| 数据一致 | 会议生命周期变更通过 Webhook 同步到日程表与 IM 会话卡片 |
| 无循环风险 | 本系统操作会议 → 腾讯回调 Webhook，回调仅更新本地数据，不反向调用腾讯 API |

### 相关文档

- [meeting-interface.md](./meeting-interface.md)：客户端 API 接口文档（请求/响应格式）
- [calendar.md](./calendar.md)：日程功能设计方案
- [interface.md](./interface.md)：认证/用户/IM API 接口文档

## 二、架构分层

```
客户端（Web/移动/桌面）
    │  Authorization: Bearer <accessToken>
    │
    └── 路由层 src/routes/wemeet.js（/api/wemeet 前缀 + JWT 中间件）
          │
          └── 控制器层 src/controllers/wemeet.controller.js
                │  · 参数校验、白名单收敛
                │  · userid 固定取 ctx.state.user.sub
                │
                └── 服务层 src/services/wemeet.service.js
                      · createRequestConfig：拼装 HMAC-SHA256 签名头
                      · axios 拦截器：请求/响应日志（敏感头脱敏）
                      · 调用腾讯会议开放平台 REST API

腾讯会议开放平台
    │  事件回调（加密 + 签名）
    │
    └── src/controllers/wemeet.controller.js（webhook，免 JWT）
          └── src/services/wemeet-webhook.service.js
                · 验签 + AES-256-CBC 解密
                · 分发事件 → 日程同步 / IM 卡片置灰
```

### 关键模块职责

| 模块 | 职责 |
|------|------|
| `wemeet.service.js` | 封装腾讯会议 REST API；统一签名、错误处理、日志脱敏 |
| `wemeet.controller.js` | HTTP 入口；校验参数、绑定登录用户身份、调用服务 |
| `wemeet-webhook.service.js` | 验签/解密回调；分发事件到日程与 IM 同步逻辑 |
| `calendar.service.js` | 日程改/取消时联动调用 `updateMeeting`/`cancelMeeting` |

## 三、签名机制

腾讯会议 REST API 采用 HMAC-SHA256 鉴权，签名在 `wemeet.service.js` 的 `generateSignature` 中实现：

1. 取请求头参数 `X-TC-Key`、`X-TC-Timestamp`、`X-TC-Nonce`，按 key 字典序排序拼成 `key=value&...`
2. 构造待签字符串：`HTTP方法 + "\n" + 排序头参数 + "\n" + URI + "\n" + Body`（GET 无 Body）
3. 用 `WEMEET_SECRET_KEY` 计算 HMAC-SHA256，十六进制摘要再做 Base64 编码
4. 放入 `X-TC-Signature` 头，连同 `AppId`、`SdkId`、`X-TC-Registered: 1` 一起发送

> 签名逻辑对客户端完全透明，客户端仅需携带本系统签发的 JWT。

## 四、环境变量配置

| 变量 | 必填 | 说明 |
|------|------|------|
| `WEMEET_SECRET_ID` | ✅ | 开放平台 SecretId，用于签名 `X-TC-Key` |
| `WEMEET_SECRET_KEY` | ✅ | 开放平台 SecretKey，HMAC-SHA256 密钥 |
| `WEMEET_APP_ID` | ✅ | 企业应用 AppId |
| `WEMEET_SDK_ID` | ✅ | 企业应用 SdkId |
| `WEMEET_API_URL` | - | API 基础地址，默认腾讯会议开放平台域名 |
| `WEMEET_ADMIN_USERID` | - | 管理员 userid，用于 `getUserInfo` 等接口的 `operator_id` 降级 |
| `WEMEET_WEBHOOK_TOKEN` | - | 事件订阅 Token，用于 Webhook 验签 |
| `WEMEET_WEBHOOK_ENCRYPT_KEY` | - | EncodingAESKey（43 位），用于 Webhook 数据 AES 解密 |

> **安全约束**：以上密钥仅允许通过环境变量注入，禁止写入代码或配置文件提交到仓库。

## 五、会议与日程联动

### 5.1 从日程触发会议变更（本系统 → 腾讯会议）

日程服务 `calendar.service.js` 在改/取消日程时，若日程关联了腾讯会议（`meeting_type='wemeet'` 且 `meeting_id` 非空），会**先**调用腾讯会议 API 同步：

| 日程操作 | 联动行为 |
|----------|----------|
| 修改日程（title/startTime/endTime 变更） | 调用 `wemeetService.updateMeeting`，成功后回写 `meeting_code` 等到本地 |
| 取消日程 | 调用 `wemeetService.cancelMeeting`；对"已取消/已结束/不存在"等幂等错误码容忍 |

采用 **API-first** 策略：腾讯会议 API 成功后再更新本地日程；API 失败则整笔请求失败（与创建日程行为一致），避免本地与腾讯状态不一致。

### 5.2 从会议事件触发日程变更（腾讯会议 → 本系统）

Webhook 收到会议事件后同步日程表（详见 [meeting-interface.md](./meeting-interface.md) 第 11 节）：

| 事件 | 同步行为 |
|------|----------|
| `meeting.created` | 无活动日程则按 `creator.userid` 创建；已存在则幂等刷新。快速会议跳过 |
| `meeting.updated` | 更新对应 `meeting_id` 的活动日程；找不到降级走 created 流程 |
| `meeting.canceled` | 软删除对应日程（`status='cancelled'`） |
| `meeting.end` | 置灰 IM 会话中对应会议邀请卡片 |

### 5.3 无循环保证

本系统主动改/取消会议后，腾讯会议会回调 `meeting.updated`/`meeting.canceled`，但 Webhook 处理逻辑**只更新本地数据库、不再反向调用腾讯 API**，因此不会形成调用环路。

## 六、Webhook 异步处理

腾讯会议 Webhook 一般有 5 秒超时，超时会触发重试（1/3/6 分钟各一次）。本服务遵循"校验通过立即 200、业务异步处理"原则：

1. 同步完成解密 + 验签（响应前必须完成）
2. 校验通过 → 立即返回 `successfully received callback`
3. 业务处理（DB 写入、WS 推送、`queryMeetingById` 补全）放入 `setImmediate` 异步执行

校验失败（解密/签名错误）返回 401 由腾讯重试；业务执行失败不触发重试，需人工介入。

## 七、安全设计

| 风险 | 防护措施 |
|------|----------|
| 身份伪造 | 会议操作 `userid` 强制取登录用户 `sub`，权限由腾讯会议侧二次校验 |
| 密钥泄露 | 所有密钥仅环境变量注入；日志对 `X-TC-Key`/`X-TC-Signature` 等敏感头脱敏 |
| 回调伪造 | Webhook 用 `SHA1(sort([token, timestamp, nonce, data]))` 验签 |
| 中间人窃听 | 回调数据 AES-256-CBC 加密传输 |
| 重复处理 | IM 卡片置灰、日程同步均设计为幂等 |
