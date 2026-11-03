const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const appSettings = require('../utils/app-settings');
const httpClient = require('./httpClient');
const im = require('./im');

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, port });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

function jsonResponse(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 0, data }));
}

const originalDevFlag = process.env.WEMEET_ALLOW_INSECURE_SERVER_URL;
const originalHttpDebugFlag = process.env.WEMEET_DEBUG_HTTP;

test.after(() => {
  if (originalDevFlag === undefined) delete process.env.WEMEET_ALLOW_INSECURE_SERVER_URL;
  else process.env.WEMEET_ALLOW_INSECURE_SERVER_URL = originalDevFlag;
  if (originalHttpDebugFlag === undefined) delete process.env.WEMEET_DEBUG_HTTP;
  else process.env.WEMEET_DEBUG_HTTP = originalHttpDebugFlag;
  appSettings.setBaseUrl(appSettings.DEFAULT_BASE_URL);
  httpClient.updateBaseUrl();
});

test('SDK Token 和常见凭据字段会被脱敏', () => {
  assert.deepEqual(httpClient.maskSensitive({ sdkToken: 'sdk-secret', sdk_token: 'sdk-secret-2', accessToken: 'access-secret' }), {
    sdkToken: '******',
    sdk_token: '******',
    accessToken: '******',
  });
});

test('默认日志不记录请求与响应业务正文', async () => {
  process.env.WEMEET_ALLOW_INSECURE_SERVER_URL = '1';
  delete process.env.WEMEET_DEBUG_HTTP;
  const privateText = 'private-message-that-must-not-be-logged';
  const endpoint = await listen((_req, res) => jsonResponse(res, [{ email: 'private@example.com', content: privateText }]));
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.map(String).join(' '));
  try {
    assert.equal(appSettings.setBaseUrl(endpoint.baseUrl).success, true);
    const data = await httpClient.request(`${endpoint.baseUrl}/api/private`);
    assert.equal(data[0].content, privateText);
    const output = logs.join('\n');
    assert.doesNotMatch(output, /private@example\.com/);
    assert.doesNotMatch(output, new RegExp(privateText));
    assert.match(output, /HTTP 200/);
  } finally {
    console.log = originalLog;
    await close(endpoint.server);
  }
});

test('默认 URL 策略拒绝不安全目标', () => {
  delete process.env.WEMEET_ALLOW_INSECURE_SERVER_URL;
  const rejected = [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com/api',
    'https://example.com?token=secret',
    'https://example.com/#fragment',
    'https://localhost',
    'https://127.0.0.1',
    'https://169.254.169.254',
    'https://10.0.0.1',
    'https://9.0.0.1',
    'https://11.0.0.1',
    'https://21.0.0.1',
    'https://30.0.0.1',
    'https://[::1]',
    'https://[fe80::1]',
    'https://[fc00::1]',
    'https://example.com:8443',
  ];

  for (const value of rejected) {
    assert.equal(appSettings.validateBaseUrl(value).success, false, value);
  }
  assert.deepEqual(appSettings.validateBaseUrl('https://example.com:7443/'), {
    success: true,
    baseUrl: 'https://example.com:7443',
  });
});

test('IM API、WebSocket 和文件 URL 动态使用最新地址', async () => {
  process.env.WEMEET_ALLOW_INSECURE_SERVER_URL = '1';
  const hits = [];
  const first = await listen((req, res) => {
    hits.push({ server: 'first', url: req.url, authorization: req.headers.authorization });
    jsonResponse(res, ['first']);
  });
  const second = await listen((req, res) => {
    hits.push({ server: 'second', url: req.url, authorization: req.headers.authorization });
    jsonResponse(res, ['second']);
  });

  try {
    assert.equal(appSettings.setBaseUrl(first.baseUrl).success, true);
    assert.deepEqual(await im.getConversations('first-token'), ['first']);

    assert.equal(appSettings.setBaseUrl(second.baseUrl).success, true);
    assert.deepEqual(await im.getConversations('second-token'), ['second']);
    assert.equal(im.getWsUrl(), second.baseUrl.replace('http:', 'ws:') + '/ws/chat');
    assert.equal(im.getFileUrl('/uploads/a.png'), second.baseUrl + '/uploads/a.png');
    assert.throws(() => im.getFileUrl('https://evil.example/steal'), /相对路径/);
    assert.throws(() => im.getFileUrl(`${second.baseUrl}/uploads/a.png`), /相对路径/);
    assert.throws(() => im.getFileUrl('/uploads/../api/auth/profile'), /不属于当前服务端/);
    assert.throws(() => im.getFileUrl('/uploads/a.png?token=secret'), /无效/);

    assert.deepEqual(hits, [
      { server: 'first', url: '/api/chat/conversations', authorization: 'Bearer first-token' },
      { server: 'second', url: '/api/chat/conversations', authorization: 'Bearer second-token' },
    ]);
  } finally {
    await Promise.all([close(first.server), close(second.server)]);
  }
});

test('文件响应体读取执行声明大小和实际大小限制', async () => {
  const response = (chunks, contentLength = '') => ({
    headers: { get: (name) => (name === 'content-length' ? contentLength : null) },
    body: (async function* body() {
      for (const chunk of chunks) yield Buffer.from(chunk);
    }()),
  });

  assert.deepEqual(
    await im.readLimitedResponseBody(response(['hello', ' world'], '11'), 11),
    Buffer.from('hello world'),
  );
  await assert.rejects(
    im.readLimitedResponseBody(response(['unused'], '101'), 100),
    /文件大小超过 100 字节限制/,
  );
  await assert.rejects(
    im.readLimitedResponseBody(response([Buffer.alloc(60), Buffer.alloc(41)]), 100),
    /文件大小超过 100 字节限制/,
  );
});

test('跨来源重定向在发送 Bearer token 前被拒绝', async () => {
  process.env.WEMEET_ALLOW_INSECURE_SERVER_URL = '1';
  let targetHits = 0;
  let targetAuthorization;
  const target = await listen((req, res) => {
    targetHits += 1;
    targetAuthorization = req.headers.authorization;
    jsonResponse(res, { reached: true });
  });
  const source = await listen((_req, res) => {
    res.writeHead(302, { Location: `http://localhost:${target.port}/private` });
    res.end();
  });

  try {
    assert.equal(appSettings.setBaseUrl(source.baseUrl).success, true);
    await assert.rejects(
      httpClient.request(`${source.baseUrl}/api/redirect`, {
        headers: { Authorization: 'Bearer must-not-leak' },
      }),
      /已拒绝发送凭据|不同来源/,
    );
    assert.equal(targetHits, 0);
    assert.equal(targetAuthorization, undefined);
  } finally {
    await Promise.all([close(source.server), close(target.server)]);
  }
});
