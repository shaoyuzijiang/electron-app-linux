'use strict';

// Linux/桌面端功能对齐回归测试：
// A. preload 通道 ↔ Linux IPC 注册 全量对齐（防 "No handler registered" 类问题）
// B. Linux 原生 addon 被条件编译裁剪的接口，禁止在 adapter 暴露（防 "不支持 ShowScreenCastView" 类问题）
// C. 后端处理器（IM/日历/通讯录/改密/缓存）行为与返回形状测试
// D. 共享 Renderer 关键联动静态断言（预定会议 → 日程同步）

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function extractChannels(source, kinds) {
  const channels = new Set();
  for (const kind of kinds) {
    const re = new RegExp(`ipc(?:Main|Renderer)\\.${kind}\\(\\s*'([a-zA-Z0-9:-]+)'`, 'g');
    let m;
    while ((m = re.exec(source)) !== null) channels.add(m[1]);
  }
  return channels;
}

// 显式允许在 Linux 缺失的 Mac/Windows 专属通道（均由能力契约关闭其 UI 入口）。
// 添加新条目时必须注明理由。
const MAC_ONLY_ALLOWLIST = new Set([
  // WebView / 企业 SSO（feature.webView/enterpriseSso = false）
  'webview-create', 'webview-resize', 'webview-close', 'webview-close-all', 'webview-hide',
  'webview-show', 'webview-get-info', 'webview-list', 'webview-go-back', 'webview-go-forward',
  'webview-reload', 'sso-request-ticket', 'jump-url-with-login-status', 'get-url-with-login-status',
  'login-by-sso',
  // SDK 偏好设置 / UserConfigService（Linux 3.26 无接口）
  'open-meeting-settings', 'get-user-config-value', 'set-user-config-value',
  'set-user-configuration', 'get-user-configuration',
  // SDK 外观模式
  'set-appearance-mode', 'get-appearance-mode',
  // 会中高级能力（meeting.captions/inviteUsers = false，或 Linux 无接口）
  'switch-caption', 'update-caption-settings', 'switch-layout',
  'subscribe-in-meeting-action-event', 'enable-address-book-callback',
  'set-need-meeting-info-callback', 'enable-invite-callbacks', 'add-users-with-param',
  'enable-custom-org-info', 'set-custom-org-info',
  'show-screen-cast-view', 'show-screen-share-view', 'show-voice-record-view',
  'show-ai-assistant-view', 'show-rooms-controller-view', 'show-pre-meeting-view',
  'get-screen-share-info', 'manipulate-window', 'bring-in-meeting-view-top',
  'set-proxy-info',
  // Token 辅助（Linux 由主进程在 adapter 内部获取，不暴露给渲染层）
  'get-sdk-token', 'get-id-token', 'fetch-id-token', 'get-current-sdk-token',
  'refresh-sdk-token', 'is-initialized', 'is-authorized',
  // 会中信息（Linux 3.26 无对应查询接口暴露）
  'get-current-meeting-info',
  // 头像悬浮子窗口（Linux 使用原生对话框替代）
  'avatar-menu-hide', 'avatar-menu-item-click',
  // 服务端默认值恢复：见 parity 说明，Linux 已支持
]);

// Mac/Windows 存在、Linux 缺失，但属于允许清单的通道在测试中逐一核对。

function testChannelParity() {
  const preload = read('bootstrap/preload.js');
  const linuxIpc = read('platform/linux-arm64/ipc.js') + read('platform/linux-arm64/backend-handlers.js');
  const macIpc = read('ipc-handlers.js');

  const preloadChannels = extractChannels(preload, ['invoke', 'send']);
  const linuxChannels = extractChannels(linuxIpc, ['handle', 'on']);
  const macChannels = extractChannels(macIpc, ['handle', 'on']);

  const missingOnLinux = [...preloadChannels].filter((ch) => !linuxChannels.has(ch));
  const unexpected = missingOnLinux.filter((ch) => !MAC_ONLY_ALLOWLIST.has(ch));
  assert.deepStrictEqual(unexpected, [],
    `Linux 缺少三端通用 IPC 通道（会触发 No handler registered）: ${unexpected.join(', ')}`);

  const staleAllowlist = [...MAC_ONLY_ALLOWLIST].filter((ch) => !macChannels.has(ch));
  assert.deepStrictEqual(staleAllowlist, [],
    `允许清单中存在 Mac/Windows 也不存在的通道（清单已过期）: ${staleAllowlist.join(', ')}`);

  const unknownLinuxChannels = [...linuxChannels].filter((ch) => !preloadChannels.has(ch) && ch !== 'login-success' && ch !== 'im-add-member-done' && ch !== 'im-new-chat-created' && ch !== 'renderer-log');
  assert.deepStrictEqual(unknownLinuxChannels, [],
    `Linux 注册了 preload 未使用的通道（疑似拼写错误）: ${unknownLinuxChannels.join(', ')}`);

  // 服务端设置恢复默认：三端通用，Linux 必须支持
  assert(linuxChannels.has('reset-server-url'), 'Linux 缺少 reset-server-url（登录页"恢复默认"会用）');
  assert(linuxChannels.has('set-proxy-info') === false || MAC_ONLY_ALLOWLIST.has('set-proxy-info'),
    'set-proxy-info 若在 Linux 注册则不应出现在允许清单');
  return { preloadCount: preloadChannels.size, linuxCount: linuxChannels.size, macOnly: missingOnLinux };
}

function testNativeGuardedInterfaces() {
  const source = read('native/linux/wemeet.cpp');
  const lines = source.split('\n');
  const guarded = new Set();
  const stack = [];
  let linuxGuardDepth = -1;

  lines.forEach((line) => {
    const trimmed = line.trim();
    const isOpen = /^(#if|#ifdef|#ifndef)/.test(trimmed);
    if (trimmed.startsWith('#ifndef __linux__')) {
      stack.push('linux');
      linuxGuardDepth = stack.length - 1;
    } else if (isOpen) {
      stack.push('other');
    } else if (trimmed.startsWith('#endif')) {
      const kind = stack.pop();
      if (kind === 'linux') {
        linuxGuardDepth = -1;
      }
    }
    const m = /^napi_value\s+([A-Za-z0-9_]+)\s*\(/.exec(trimmed);
    if (m && linuxGuardDepth !== -1 && stack[linuxGuardDepth] === 'linux') {
      guarded.add(m[1]);
    }
  });

  assert(guarded.has('ShowScreenCastView'), '基线校验：ShowScreenCastView 应在 Linux 被裁剪（真机已证实）');

  const adapter = read('platform/linux-arm64/sdk-adapter.js');
  const openViewMethods = [...adapter.matchAll(/([A-Za-z]+): \['([A-Za-z0-9_]+)'/g)].map((m) => m[2]);
  for (const fn of openViewMethods) {
    assert(!guarded.has(fn), `adapter openView 暴露了 Linux 被裁剪的原生接口: ${fn}`);
  }

  const requiredMatch = /const required = \[([\s\S]*?)\];/.exec(adapter);
  assert(requiredMatch, 'adapter 缺少 addon 必需接口清单');
  const requiredFns = [...requiredMatch[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
  for (const fn of requiredFns) {
    assert(!guarded.has(fn), `adapter 必需接口清单包含 Linux 被裁剪的函数: ${fn}`);
  }
  return { guardedCount: guarded.size, guardedList: [...guarded].sort() };
}

async function testBackendHandlers() {
  const { registerBackendHandlers } = require('../platform/linux-arm64/backend-handlers');
  const registered = new Map();
  const sent = [];
  const ipcMain = {
    handle: (channel, handler) => registered.set(channel, handler),
    on: (channel, handler) => sent.push([channel, handler]),
  };
  const openedPaths = [];
  const shell = { openPath: async (p) => { openedPaths.push(p); return ''; } };
  const app = { getPath: () => '/tmp/wemeet-parity-test-userdata' };
  const api = {
    getConversations: async () => [{ id: 'c1' }],
    createConversation: async (_t, params) => ({ id: 'c2', ...params }),
    changePassword: async (_t, oldPwd, newPwd) => { assert(oldPwd && newPwd); return { ok: true }; },
    getDepartmentTree: async () => ([{ id: 'root', name: '全部' }]),
    getDepartmentUsers: async (_t, deptId, options) => {
      assert.strictEqual(typeof deptId, 'string');
      assert.strictEqual(typeof options.recursive, 'boolean');
      return { list: [{ userId: 'u1' }], total: 1 };
    },
    searchUsers: async (_t, query) => { assert.strictEqual(typeof query, 'string'); return []; },
    createEvent: async (_t, params) => {
      assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(params.startTime), '日程开始时间必须是 YYYY-MM-DD HH:MM:SS 本地格式');
      assert(params.meeting && params.meeting.meetingType === 'wemeet', '日程必须携带 wemeet 会议信息');
      assert(params.meeting.meetingCode, '日程必须携带会议号');
      return { id: 'e1' };
    },
    getEvents: async () => [],
    getFileUrl: (p) => `https://backend.example/files/${p}`,
    getWsUrl: () => 'wss://backend.example/ws',
  };
  let tokenCalls = 0;
  const getValidAccessToken = async () => { tokenCalls += 1; return 'access-token'; };
  const logger = { writeLog: () => {} };
  const getMainWindow = () => null;

  registerBackendHandlers({ ipcMain, shell, app, api, logger, getMainWindow, getValidAccessToken });

  // 成功路径：返回形状必须与共享 Renderer 的消费方式一致
  const conversations = await registered.get('im-get-conversations')();
  assert.deepStrictEqual(conversations, { success: true, data: [{ id: 'c1' }] });

  const tree = await registered.get('get-department-tree')();
  assert.deepStrictEqual(tree, { success: true, data: [{ id: 'root', name: '全部' }] });

  const users = await registered.get('get-department-users')({}, { departmentId: 'root', recursive: true, page: 1, pageSize: 50 });
  assert.strictEqual(users.success, true);
  assert.strictEqual(users.data.total, 1);

  const created = await registered.get('im-create-conversation')({}, { type: 'group', name: 'n', memberIds: ['u1'] });
  assert.strictEqual(created.success, true);

  const pwd = await registered.get('change-password')({}, { oldPassword: 'a', newPassword: 'b' });
  assert.strictEqual(pwd.success, true);

  const ws = registered.get('get-ws-url')();
  assert(ws.url.startsWith('wss://'), 'WS 地址必须来自后端');

  // 未登录路径：统一返回 401 语义提示（使用独立注册表，不污染后续用例）
  const failingToken = async () => { const e = new Error('未登录'); throw e; };
  const unauthorizedMap = new Map();
  registerBackendHandlers({
    ipcMain: { handle: (channel, handler) => unauthorizedMap.set(channel, handler), on: () => {} },
    shell, app, api, logger, getMainWindow, getValidAccessToken: failingToken,
  });
  assert.strictEqual(tokenCalls >= 1, true);
  const unauthorized = await unauthorizedMap.get('im-get-conversations')();
  assert.deepStrictEqual(unauthorized, { success: false, message: '未登录，请重新登录' });

  // 图片缓存：首取下载并缓存，再取命中缓存
  const serverPath = '/uploads/test.png';
  const cacheFile = path.join('/tmp/wemeet-parity-test-userdata', 'cache', 'uploads', 'test.png');
  fs.rmSync(path.join('/tmp/wemeet-parity-test-userdata', 'cache'), { recursive: true, force: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert(options.headers.Authorization === 'Bearer access-token', '图片下载必须携带 Access Token');
    assert(url.includes('test.png'));
    return {
      ok: true,
      headers: { 'content-type': 'image/png' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };
  try {
    const first = await registered.get('fetch-image-data')({}, { path: serverPath });
    assert(first.success && first.data.startsWith('data:image/png;base64,'));
    assert(fs.existsSync(cacheFile), '图片必须写入本地缓存');
    globalThis.fetch = async () => { throw new Error('缓存命中时不应再次下载'); };
    const second = await registered.get('fetch-image-data')({}, { path: serverPath });
    assert(second.success && second.data.startsWith('data:image/png;base64,'));
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { handlerCount: registered.size };
}

function testRendererIntegrations() {
  const meeting = read('renderer/js/meeting.js');
  assert(meeting.includes('syncMeetingToCalendar(result.data'), '预定成功后必须触发日程同步');
  for (const field of ['meetingType', 'meetingId', 'meetingCode', 'joinUrl', 'meetingSubject']) {
    assert(meeting.includes(field), `日程同步 payload 缺少契约字段: ${field}`);
  }
  assert(meeting.includes('feature.calendar'), '日程同步必须受能力契约开关保护');

  const contacts = read('renderer/js/contacts.js');
  assert(contacts.includes("result.message ? '：' + result.message"), '通讯录失败必须透传后端错误信息');

  const calendar = read('renderer/js/calendar.js');
  assert(calendar.includes("status: 'active'"), '日历加载必须携带 status 过滤');
}

// 交付清单覆盖：Linux 运行链路 require 的本地顶层目录，
// 必须同时出现在离线传输包与 DEB staging 的白名单里。
function testDeliveryWhitelist() {
  const platformFiles = ['main.js', 'backend-handlers.js', 'ipc.js', 'sdk-adapter.js', 'graphics-env.js', 'capabilities.js']
    .map((f) => read(`platform/linux-arm64/${f}`));
  const required = new Set();
  for (const source of platformFiles) {
    for (const m of source.matchAll(/require\('\.\.\/\.\.\/([a-z_]+)\//g)) {
      required.add(m[1]);
    }
  }
  assert(required.size > 0, '未解析到 Linux 主进程的本地依赖目录');

  const transfer = read('scripts/make-transfer-package.sh');
  const deb = read('scripts/build-deb.sh');
  for (const dir of required) {
    assert(new RegExp(`[ "']${dir}[ "']`).test(transfer), `离线传输包白名单缺少目录: ${dir}`);
    assert(new RegExp(`[ ;"]${dir}[ ;"]`).test(deb), `DEB staging 白名单缺少目录: ${dir}`);
  }
  return [...required].sort();
}

// 交付树闭包：以 Linux 真实运行入口为起点，广度优先解析全部相对 require，
// 任何解析到"未交付文件"的引用都是真机 MODULE_NOT_FOUND 隐患。
const EXEMPT_PREFIXES = ['node_modules/', 'build/', 'output/', 'wemeet_sdk/', '.electron-headers/'];
const JS_ENTRIES = [
  'main.js',
  'main-darwin-win32.js',
  'ipc-handlers.js',
  'bootstrap/preload.js',
  'bootstrap/launch.js',
  ...fs.readdirSync(path.join(ROOT, 'scripts'))
    .filter((f) => f.startsWith('validate-') && f.endsWith('.js'))
    .map((f) => `scripts/${f}`),
];

function collectDeliveredFiles() {
  const transfer = read('scripts/make-transfer-package.sh');
  const listMatch = /for relative in \\\r?\n([\s\S]*?); do/.exec(transfer);
  assert(listMatch, '无法解析传输包白名单');
  const delivered = new Set();
  for (const raw of listMatch[1].split(/\s+/)) {
    const rel = raw.trim().replace(/\\$/, '');
    if (!rel) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) throw new Error(`白名单文件不存在: ${rel}`);
    if (fs.statSync(abs).isDirectory()) {
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === '.DS_Store') continue;
          const child = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(child);
          else delivered.add(path.relative(ROOT, child));
        }
      };
      walk(abs);
    } else {
      delivered.add(rel);
    }
  }
  return delivered;
}

function testDeliveryTreeClosure() {
  const delivered = collectDeliveredFiles();
  const queue = JS_ENTRIES.filter((f) => delivered.has(f));
  assert(queue.includes('main.js'), '入口 main.js 必须在交付集合内');
  const visited = new Set(queue);
  const broken = [];

  while (queue.length) {
    const file = queue.shift();
    // 剥离块注释与行注释（保护字符串里的 https://），避免文档示例被误判为 require
    const source = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    for (const m of source.matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)) {
      const base = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, file)), m[1]));
      // 解析优先级：精确路径 → .js → 目录 index.js（与 Node require 语义一致）
      const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
      const target = candidates.find((c) => delivered.has(c))
        || candidates.find((c) => fs.existsSync(path.join(ROOT, c)));
      if (!target) {
        if (EXEMPT_PREFIXES.some((p) => base.startsWith(p))) continue;
        broken.push(`${file} → ${m[1]}（目标不存在且未豁免）`);
        continue;
      }
      if (!delivered.has(target)) {
        broken.push(`${file} → ${m[1]}（${target} 未交付）`);
        continue;
      }
      if (visited.has(target)) continue;
      visited.add(target);
      if (target.endsWith('.js')) queue.push(target);
    }
  }
  assert.deepStrictEqual(broken, [], `交付树存在未交付的运行时依赖: \n  ${broken.join('\n  ')}`);

  // Shell 引用闭包：scripts/ 与 packaging/ 内引用的脚本必须已交付
  const shellFiles = [...delivered].filter((f) => /^scripts\/.*\.sh$/.test(f) || /^packaging\/[^/]+\.sh$/.test(f));
  for (const file of shellFiles) {
    const source = read(file);
    for (const m of source.matchAll(/((?:scripts|packaging)\/[A-Za-z0-9._-]+\.(?:sh|js))/g)) {
      assert(delivered.has(m[1]), `${file} 引用的 ${m[1]} 未交付`);
    }
  }
  return { delivered: delivered.size, reachable: visited.size };
}

async function run() {
  const parity = testChannelParity();
  const native = testNativeGuardedInterfaces();
  const backend = await testBackendHandlers();
  testRendererIntegrations();
  const delivery = testDeliveryWhitelist();
  const closure = testDeliveryTreeClosure();

  console.log(`Linux 功能对齐校验通过：`);
  console.log(`  - preload 通道 ${parity.preloadCount} 个，Linux 已注册 ${parity.linuxCount} 个，Mac 专属 ${parity.macOnly.length} 个（允许清单核对通过）`);
  console.log(`  - Linux 被裁剪原生接口 ${native.guardedCount} 个，adapter 未暴露任何一个`);
  console.log(`  - 后端处理器行为测试 ${backend.handlerCount} 个通道，含成功/未登录/缓存路径`);
  console.log(`  - Renderer 联动断言（预定→日程、通讯录错误透传）通过`);
  console.log(`  - 交付清单覆盖：运行链路依赖目录 [${delivery.join(', ')}] 均已进传输包与 DEB 白名单`);
  console.log(`  - 交付树闭包：${closure.delivered} 个交付文件，从运行入口可达 ${closure.reachable} 个，无缺失依赖`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
