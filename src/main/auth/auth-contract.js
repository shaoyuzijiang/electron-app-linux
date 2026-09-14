'use strict';

const { URL } = require('node:url');

/**
 * 阶段 2D 鉴权契约：只定义主进程未来集成边界，不发起网络请求、不保存凭证。
 * 服务端基地址必须由受信任的发布配置提供，不能来自 Renderer 或用户输入。
 */
const AUTH_ENDPOINTS = Object.freeze({
  publicKey: Object.freeze({ method: 'GET', path: '/api/auth/public-key', requiresAccessToken: false }),
  login: Object.freeze({ method: 'POST', path: '/api/auth/login', requiresAccessToken: false }),
  refresh: Object.freeze({ method: 'POST', path: '/api/auth/refresh', requiresAccessToken: false }),
  profile: Object.freeze({ method: 'GET', path: '/api/auth/profile', requiresAccessToken: true }),
  sdkToken: Object.freeze({ method: 'GET', path: '/api/auth/sdk-token', requiresAccessToken: true }),
  idToken: Object.freeze({ method: 'GET', path: '/api/auth/id-token', requiresAccessToken: true }),
  logout: Object.freeze({ method: 'POST', path: '/api/auth/logout', requiresAccessToken: true })
});

const AUTH_LOGIN_SEQUENCE = Object.freeze([
  'getPublicKey',
  'loginBusinessAccount',
  'getProfile',
  'getSdkInitMaterial',
  'initializeSdkAndWaitForCallback',
  'getSdkLoginMaterial',
  'loginSdkAndWaitForCallback'
]);

function createPublicAuthState({ authenticated = false, profile = null, sessionExpiresAt = null } = {}) {
  return Object.freeze({
    authenticated: Boolean(authenticated),
    profile: profile ? Object.freeze({ displayName: String(profile.displayName || '') }) : null,
    sessionExpiresAt: sessionExpiresAt || null
  });
}

function assertTrustedApiBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('鉴权服务地址必须是无用户信息、无查询参数的 HTTPS 基地址');
  }
  return parsed.toString().replace(/\/$/, '');
}

module.exports = { AUTH_ENDPOINTS, AUTH_LOGIN_SEQUENCE, assertTrustedApiBaseUrl, createPublicAuthState };
