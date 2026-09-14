'use strict';

const MAX_CALLBACK_BYTES = 16 * 1024;
const SENSITIVE_KEY = /token|password|secret|sso.?url|authorization/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(nested)]));
  }
  return typeof value === 'string' && value.length > 2048 ? `${value.slice(0, 2048)}…` : value;
}

function parseCallback(payload) {
  let parsed = payload;
  if (typeof payload === 'string') {
    if (Buffer.byteLength(payload, 'utf8') > MAX_CALLBACK_BYTES) {
      return { ok: false, error: '回调内容超过大小限制' };
    }
    try {
      parsed = JSON.parse(payload);
    } catch {
      return { ok: false, error: '回调不是有效 JSON' };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '回调必须是 JSON 对象' };
  }
  return { ok: true, value: redact(parsed) };
}

module.exports = { parseCallback, redact };
