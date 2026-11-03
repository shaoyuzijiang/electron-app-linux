/**
 * IM 即时通讯 API
 * - 会话管理（列表/创建/详情/成员）
 * - 消息收发（HTTP 备用通道）
 * - 未读 / 在线状态
 * - 文件上传
 * - WebSocket URL 与文件 URL 辅助
 */

const crypto = require('crypto');
const { getBaseUrl, request, fetchSafeResponse } = require('./httpClient');

const MAX_FILE_DOWNLOAD_BYTES = 100 * 1024 * 1024;

/**
 * 获取会话列表
 * @param {string} accessToken
 * @returns {Array<ConversationListItem>}
 */
async function getConversations(accessToken) {
  return await request(`${getBaseUrl()}/api/chat/conversations`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 创建会话
 * @param {string} accessToken
 * @param {object} params - { type: 'single'|'group', name: string, memberIds: string[] }
 * @returns {{ id: string }}
 */
async function createConversation(accessToken, params) {
  return await request(`${getBaseUrl()}/api/chat/conversations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/**
 * 获取会话详情
 * @param {string} accessToken
 * @param {string} conversationId
 * @returns {ConversationDetail}
 */
async function getConversationDetail(accessToken, conversationId) {
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 获取历史消息
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {object} [options] - { before?: string, after?: string, limit?: number }
 * @returns {Array<Message>}
 */
async function getMessages(accessToken, conversationId, options = {}) {
  const params = new URLSearchParams();
  if (options.before) params.append('before', options.before);
  if (options.after) params.append('after', options.after);
  if (options.limit) params.append('limit', options.limit);
  const qs = params.toString() ? '?' + params : '';
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}/messages${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 发送消息（HTTP 备用通道）
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {object} params - { type?: string, content: string }
 * @returns {Message}
 */
async function sendMessageHttp(accessToken, conversationId, params) {
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/**
 * 标记已读
 * @param {string} accessToken
 * @param {string} conversationId
 */
async function markConversationRead(accessToken, conversationId) {
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 获取会话成员列表
 * @param {string} accessToken
 * @param {string} conversationId
 */
async function getConversationMembers(accessToken, conversationId) {
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}/members`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 添加成员（群聊）
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {string} userId
 */
async function addConversationMember(accessToken, conversationId, userId) {
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

/**
 * 移除成员（群聊）
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {string} userId
 */
async function removeConversationMember(accessToken, conversationId, userId) {
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}/members/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 修改群聊信息（群名/群头像）
 * 仅群主或管理员可操作，仅适用于群聊。
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {object} params - { name?: string, avatar?: string }，至少传一项
 */
async function updateConversation(accessToken, conversationId, params) {
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/**
 * 解散群聊
 * 仅群主可操作，仅适用于群聊。解散后会话、成员关系、消息全部删除，不可恢复。
 * @param {string} accessToken
 * @param {string} conversationId
 */
async function dissolveConversation(accessToken, conversationId) {
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 转让群主
 * 仅群主可操作，仅适用于群聊。转让后原群主降为普通成员。
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {string} userId - 新群主的用户ID（必须是当前群成员）
 */
async function transferOwnership(accessToken, conversationId, userId) {
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}/transfer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

/**
 * 设置/取消管理员
 * 仅群主可操作，仅适用于群聊。不能修改自己的角色或群主的角色。
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {string} userId - 目标成员用户ID
 * @param {string} role - "admin"（设为管理员）或 "member"（取消管理员）
 */
async function setMemberRole(accessToken, conversationId, userId, role) {
  return await request(`${getBaseUrl()}/api/chat/conversations/${conversationId}/members/${userId}/role`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

/**
 * 获取总未读消息数
 * @param {string} accessToken
 * @returns {{ count: number }}
 */
async function getUnreadCount(accessToken) {
  return await request(`${getBaseUrl()}/api/chat/unread/count`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 获取在线用户列表
 * @param {string} accessToken
 */
async function getOnlineUsers(accessToken) {
  return await request(`${getBaseUrl()}/api/chat/online`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * 上传文件/图片
 * @param {string} accessToken
 * @param {Buffer} fileBuffer
 * @param {string} filename
 * @param {string} mimetype
 * @returns {UploadFile}
 */
async function uploadFile(accessToken, fileBuffer, filename, mimetype) {
  // 手动构造 multipart/form-data，避免 FormData/Blob 在 Electron 主进程的兼容问题
  const boundary = '----FormBoundary' + crypto.randomBytes(16).toString('hex');
  const safeFilename = String(filename || 'file').replace(/[\r\n"]/g, '_');
  const safeMimetype = /^[\w.+-]+\/[\w.+-]+$/.test(mimetype) ? mimetype : 'application/octet-stream';
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${safeFilename}"\r\n` +
    `Content-Type: ${safeMimetype}\r\n\r\n`,
    'utf8'
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([header, fileBuffer, footer]);

  try {
    return await request(`${getBaseUrl()}/api/chat/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      body,
    });
  } catch (err) {
    throw new Error(`文件上传失败：${err.message}`);
  }
}

/**
 * 获取 WebSocket URL
 * @returns {string}
 */
function getWsUrl() {
  return getBaseUrl().replace(/^http/, 'ws') + '/ws/chat';
}

/**
 * 获取文件访问的完整 URL
 * @param {string} path - 如 "/uploads/xxx.jpg"
 * @returns {string}
 */
function getFileUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/uploads/')) {
    throw new Error('文件路径必须是 /uploads/ 下的相对路径');
  }
  const baseUrl = getBaseUrl();
  const parsed = new URL(path, `${baseUrl}/`);
  if (parsed.origin !== new URL(baseUrl).origin || !parsed.pathname.startsWith('/uploads/') || parsed.search || parsed.hash) {
    throw new Error('文件路径无效或不属于当前服务端');
  }
  return parsed.toString();
}

function getResponseHeader(response, name) {
  if (!response || !response.headers) return '';
  if (typeof response.headers.get === 'function') return response.headers.get(name) || '';
  return response.headers[String(name).toLowerCase()] || response.headers[name] || '';
}

/**
 * 流式读取下载响应并限制总大小；同时校验可信的 Content-Length 声明。
 */
async function readLimitedResponseBody(response, maxBytes = MAX_FILE_DOWNLOAD_BYTES) {
  const contentLength = getResponseHeader(response, 'content-length');
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > maxBytes) {
      throw new Error(`文件大小超过 ${maxBytes} 字节限制`);
    }
  }

  if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`文件大小超过 ${maxBytes} 字节限制`);
    return buffer;
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      if (typeof response.body.destroy === 'function') response.body.destroy();
      throw new Error(`文件大小超过 ${maxBytes} 字节限制`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes);
}

async function downloadFile(accessToken, serverPath) {
  const response = await fetchSafeResponse(getFileUrl(serverPath), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    buffer: await readLimitedResponseBody(response),
    contentType: getResponseHeader(response, 'content-type'),
  };
}

module.exports = {
  getConversations,
  createConversation,
  getConversationDetail,
  updateConversation,
  dissolveConversation,
  transferOwnership,
  setMemberRole,
  getMessages,
  sendMessageHttp,
  markConversationRead,
  getConversationMembers,
  addConversationMember,
  removeConversationMember,
  getUnreadCount,
  getOnlineUsers,
  uploadFile,
  getWsUrl,
  getFileUrl,
  downloadFile,
  readLimitedResponseBody,
  MAX_FILE_DOWNLOAD_BYTES,
};
