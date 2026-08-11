/**
 * 应用设置（持久化）
 * - 服务端 URL 等可配置项
 * - 存储在 userData/app-settings.json
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 默认服务端 URL
const DEFAULT_BASE_URL = 'https://wemeetsdkdemo-uat.liuqi92.cn:7443';

let settings = null;
let settingsPath = null;

function getSettingsPath() {
  if (!settingsPath) {
    // app.whenReady() 之前 getPath 可能不可用，降级使用默认值
    try {
      settingsPath = path.join(app.getPath('userData'), 'app-settings.json');
    } catch {
      settingsPath = null; // app 未就绪，使用默认值
    }
  }
  return settingsPath;
}

function loadSettings() {
  if (settings) return settings;
  const p = getSettingsPath();
  if (!p) {
    // app 尚未就绪，返回默认设置（后续首次调用 setBaseUrl 会触发持久化）
    settings = { baseUrl: DEFAULT_BASE_URL };
    return settings;
  }
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    settings = {};
  }
  if (!settings.baseUrl || typeof settings.baseUrl !== 'string') {
    settings.baseUrl = DEFAULT_BASE_URL;
  }
  return settings;
}

function saveSettings() {
  const p = getSettingsPath();
  if (!p) {
    // app 尚未就绪，仅更新内存（下次调用时会被覆盖）
    return;
  }
  try {
    fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Settings] 保存失败:', err.message);
  }
}

/**
 * 获取服务端 URL（去除末尾斜杠）
 */
function getBaseUrl() {
  const s = loadSettings();
  return (s.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * 设置服务端 URL
 * @returns {{success: boolean, message?: string, baseUrl: string}}
 */
function setBaseUrl(url) {
  if (!url || typeof url !== 'string') {
    return { success: false, message: 'URL 不能为空', baseUrl: getBaseUrl() };
  }
  const trimmed = url.trim().replace(/\/+$/, '');
  // 基础校验：必须以 http:// 或 https:// 开头
  if (!/^https?:\/\//.test(trimmed)) {
    return { success: false, message: 'URL 必须以 http:// 或 https:// 开头', baseUrl: getBaseUrl() };
  }
  const s = loadSettings();
  s.baseUrl = trimmed;
  saveSettings();
  console.log(`[Settings] 服务端 URL 已更新: ${trimmed}`);
  return { success: true, baseUrl: trimmed };
}

function resetBaseUrl() {
  const s = loadSettings();
  s.baseUrl = DEFAULT_BASE_URL;
  saveSettings();
  console.log(`[Settings] 服务端 URL 已重置为默认: ${DEFAULT_BASE_URL}`);
  return { success: true, baseUrl: DEFAULT_BASE_URL };
}

module.exports = {
  DEFAULT_BASE_URL,
  getBaseUrl,
  setBaseUrl,
  resetBaseUrl,
};
