'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTH_ENDPOINTS, AUTH_LOGIN_SEQUENCE, assertTrustedApiBaseUrl, createPublicAuthState } = require('../src/main/auth/auth-contract');

test('鉴权契约保持与既有后端一致的七个接口', () => {
  assert.deepEqual(Object.values(AUTH_ENDPOINTS).map((endpoint) => endpoint.path), [
    '/api/auth/public-key',
    '/api/auth/login',
    '/api/auth/refresh',
    '/api/auth/profile',
    '/api/auth/sdk-token',
    '/api/auth/id-token',
    '/api/auth/logout'
  ]);
  assert.deepEqual(AUTH_LOGIN_SEQUENCE, [
    'getPublicKey',
    'loginBusinessAccount',
    'getProfile',
    'getSdkInitMaterial',
    'initializeSdkAndWaitForCallback',
    'getSdkLoginMaterial',
    'loginSdkAndWaitForCallback'
  ]);
});

test('仅允许受信任 HTTPS 鉴权服务地址', () => {
  assert.equal(assertTrustedApiBaseUrl('https://auth.example.test'), 'https://auth.example.test');
  assert.throws(() => assertTrustedApiBaseUrl('http://auth.example.test'), /HTTPS/);
  assert.throws(() => assertTrustedApiBaseUrl('https://user:pass@auth.example.test'), /HTTPS/);
});

test('公开鉴权状态不会包含凭证字段', () => {
  const state = createPublicAuthState({
    authenticated: true,
    profile: { displayName: 'Mock User', accessToken: 'not-exposed' },
    sessionExpiresAt: '2030-01-01T00:00:00.000Z'
  });
  assert.deepEqual(state, {
    authenticated: true,
    profile: { displayName: 'Mock User' },
    sessionExpiresAt: '2030-01-01T00:00:00.000Z'
  });
  assert.equal(Object.hasOwn(state.profile, 'accessToken'), false);
});
