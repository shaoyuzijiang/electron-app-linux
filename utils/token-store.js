'use strict';

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

let tokens = null;
let sdkTokenData = null;
let idTokenData = null;

function tokenPath() {
  return path.join(app.getPath('userData'), 'auth-tokens.enc');
}

function legacyTokenPath() {
  return path.join(app.getPath('userData'), 'auth-tokens.json');
}

function canPersistSecurely() {
  return process.platform !== 'linux' && safeStorage.isEncryptionAvailable();
}

function removePersistedTokens() {
  for (const file of [tokenPath(), legacyTokenPath()]) {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
}

function loadTokens() {
  if (tokens) return tokens;
  if (!canPersistSecurely()) {
    removePersistedTokens();
    return null;
  }
  try {
    tokens = JSON.parse(safeStorage.decryptString(fs.readFileSync(tokenPath())));
  } catch {
    tokens = null;
  }
  return tokens;
}

function saveTokens(tokenData) {
  tokens = {
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresIn: Number(tokenData.expiresIn || 0),
    tokenType: tokenData.tokenType,
    savedAt: Date.now(),
  };
  if (!canPersistSecurely()) {
    removePersistedTokens();
    console.warn('[Auth] Linux Token 仅保存在当前进程内存中');
    return false;
  }
  const file = tokenPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(tokens)), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  try { fs.rmSync(legacyTokenPath(), { force: true }); } catch {}
  return true;
}

function getTokens() {
  return tokens || loadTokens();
}

function clearTokens() {
  tokens = null;
  removePersistedTokens();
}

function isAccessTokenExpired() {
  const value = getTokens();
  if (!value || !value.accessToken) return true;
  return Date.now() >= value.savedAt + value.expiresIn * 1000 - 30000;
}

function saveSdkToken(data) { sdkTokenData = data || null; }
function getSdkToken() { return sdkTokenData; }
function saveIdToken(data) { idTokenData = data || null; }
function getIdToken() { return idTokenData; }
function clearMeetingTokens() { sdkTokenData = null; idTokenData = null; }

module.exports = {
  loadTokens,
  saveTokens,
  getTokens,
  clearTokens,
  isAccessTokenExpired,
  canPersistSecurely,
  saveSdkToken,
  getSdkToken,
  saveIdToken,
  getIdToken,
  clearMeetingTokens,
};
