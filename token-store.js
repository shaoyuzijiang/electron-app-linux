/**
 * Token 存储管理
 * 使用 electron-store 的简单内存+文件存储方案
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const TOKEN_FILE = path.join(app.getPath('userData'), 'auth-tokens.json');

let tokens = null;

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, 'utf-8');
      tokens = JSON.parse(data);
    }
  } catch {
    tokens = null;
  }
  return tokens;
}

function saveTokens(tokenData) {
  tokens = {
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresIn: tokenData.expiresIn,
    tokenType: tokenData.tokenType,
    savedAt: Date.now(),
  };
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
  } catch {
    // 静默处理写入失败
  }
}

function getTokens() {
  return tokens || loadTokens();
}

function clearTokens() {
  tokens = null;
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  } catch {
    // 静默处理
  }
}

/**
 * 检查 accessToken 是否已过期
 */
function isAccessTokenExpired() {
  const t = getTokens();
  if (!t) return true;
  const expiresAt = t.savedAt + t.expiresIn * 1000;
  // 提前 30 秒视为过期，避免边界问题
  return Date.now() > expiresAt - 30 * 1000;
}

module.exports = { loadTokens, saveTokens, getTokens, clearTokens, isAccessTokenExpired };
