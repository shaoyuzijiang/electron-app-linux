/**
 * 账号管理
 *
 * 负责持久化保存用户勾选"记住密码"后的多个账号信息（邮箱 + 加密密码）。
 * 密码使用 Electron 的 safeStorage 进行加密（依赖 OS Keychain/Credential Manager），
 * 加密后的二进制数据落盘到 userData/accounts.dat。
 *
 * 与 utils/token-store.js 的区别：token-store 只保存当前已登录账号的 token（accessToken/refreshToken），
 * 本模块保存的是"账号历史"，包括未登录状态下用户希望下次可一键填充的多个邮箱+密码。
 */
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.dat');

// 内存中的账号列表
// 单条结构：{ email, encryptedPassword, lastUsed, profileName, profileAvatar }
let accounts = [];

/**
 * 加载本地保存的账号列表
 * - 文件不存在：返回空数组
 * - safeStorage 不可用：返回空数组（回退方案为不允许保存密码）
 * - 解密/解析失败：清空文件并返回空数组
 */
function loadAccounts() {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
      accounts = [];
      return accounts;
    }
    const buffer = fs.readFileSync(ACCOUNTS_FILE);
    if (!buffer || buffer.length === 0) {
      accounts = [];
      return accounts;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      // 当前环境没有可用的加密后端（极少见，例如 Linux 上无 keyring）
      // 直接放弃历史账号，避免明文落盘
      console.warn('[AccountStore] safeStorage 不可用，禁用账号历史功能');
      accounts = [];
      return accounts;
    }
    const plain = safeStorage.decryptString(buffer);
    const parsed = JSON.parse(plain);
    if (Array.isArray(parsed)) {
      accounts = parsed.filter(
        (item) => item && typeof item.email === 'string' && typeof item.encryptedPassword === 'string'
      );
    } else {
      accounts = [];
    }
  } catch (err) {
    console.error('[AccountStore] 加载账号列表失败:', err.message);
    accounts = [];
  }
  return accounts;
}

/**
 * 写入加密文件
 */
function persist() {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[AccountStore] safeStorage 不可用，跳过写入');
      return false;
    }
    const plain = JSON.stringify(accounts);
    const encrypted = safeStorage.encryptString(plain);
    fs.writeFileSync(ACCOUNTS_FILE, encrypted);
    return true;
  } catch (err) {
    console.error('[AccountStore] 写入账号列表失败:', err.message);
    return false;
  }
}

/**
 * 获取账号列表（不含明文密码）
 * 仅返回 email、profile、lastUsed 等元信息，供 UI 展示和选择。
 */
function listAccounts() {
  if (accounts.length === 0) loadAccounts();
  return accounts.map((item) => ({
    email: item.email,
    profileName: item.profileName || '',
    profileAvatar: item.profileAvatar || '',
    lastUsed: item.lastUsed || 0,
  }));
}

/**
 * 根据邮箱获取解密后的密码
 * @param {string} email
 * @returns {string} 解密后的明文密码；账号不存在或解密失败返回 ''
 */
function getPassword(email) {
  if (!email) return '';
  if (accounts.length === 0) loadAccounts();
  const target = accounts.find((item) => item.email === email);
  if (!target) return '';
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(target.encryptedPassword, 'base64'));
  } catch (err) {
    console.error('[AccountStore] 解密密码失败:', err.message);
    return '';
  }
}

/**
 * 保存或更新账号
 * - 已存在相同 email：更新密码、profile、lastUsed
 * - 不存在：追加到列表
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.password 明文密码（调用方负责保证来源可信）
 * @param {Object} [params.profile] 登录成功后的用户信息（昵称、头像等）
 * @returns {boolean}
 */
function saveAccount({ email, password, profile } = {}) {
  if (!email || !password) return false;
  if (accounts.length === 0) loadAccounts();

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[AccountStore] safeStorage 不可用，账号未保存');
    return false;
  }

  let encryptedB64;
  try {
    encryptedB64 = safeStorage.encryptString(password).toString('base64');
  } catch (err) {
    console.error('[AccountStore] 加密密码失败:', err.message);
    return false;
  }

  const idx = accounts.findIndex((item) => item.email === email);
  const record = {
    email,
    encryptedPassword: encryptedB64,
    lastUsed: Date.now(),
    profileName: profile?.name || profile?.nickname || (idx >= 0 ? accounts[idx].profileName : '') || '',
    profileAvatar: profile?.avatar || (idx >= 0 ? accounts[idx].profileAvatar : '') || '',
  };

  if (idx >= 0) {
    accounts[idx] = record;
  } else {
    accounts.push(record);
  }

  // 按 lastUsed 倒序，最常用的在前面
  accounts.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));

  return persist();
}

/**
 * 删除指定邮箱的账号
 * @param {string} email
 * @returns {boolean}
 */
function removeAccount(email) {
  if (!email) return false;
  if (accounts.length === 0) loadAccounts();
  const before = accounts.length;
  accounts = accounts.filter((item) => item.email !== email);
  if (accounts.length === before) return false;
  return persist();
}

/**
 * 清空所有已保存账号
 */
function clearAccounts() {
  accounts = [];
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      fs.unlinkSync(ACCOUNTS_FILE);
    }
  } catch (err) {
    console.error('[AccountStore] 清空账号文件失败:', err.message);
  }
  return true;
}

module.exports = {
  loadAccounts,
  listAccounts,
  getPassword,
  saveAccount,
  removeAccount,
  clearAccounts,
};
