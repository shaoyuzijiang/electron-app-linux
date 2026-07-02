/**
 * Web SSO 接口封装
 *
 * 文档：backend_api/sso.md、backend_api/sso-interface.md
 * 流程：APP 拿 Access Token 申请一次性 Ticket -> 浏览器（WebView）打开
 *       /sso/redirect?ticket=xxx -> 服务端 302 + Set-Cookie -> 目标页
 */

const { BASE_URL, request } = require('./httpClient');

/**
 * 颁发一次性 SSO Ticket
 * @param {string} accessToken - 当前用户 Access Token（Bearer）
 * @param {object} params
 * @param {string} params.audience - 受众白名单，如 'web-user-center:organization'
 * @param {string} params.target   - 目标路径，如 '/user-center/organization-management'
 * @param {string} [params.nonce]  - 可选，APP 生成的 16-64 字符防重放串
 * @returns {Promise<{ticket: string, jti: string, expiresIn: number, expiresAt: number}>}
 */
async function requestSsoTicket(accessToken, { audience, target, nonce } = {}) {
  if (!accessToken) throw new Error('未登录');
  if (!audience) throw new Error('缺少 audience');
  if (!target) throw new Error('缺少 target');

  const body = { audience, target };
  if (nonce) body.nonce = nonce;

  return await request(`${BASE_URL}/api/auth/sso/ticket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
}

module.exports = {
  requestSsoTicket,
};
