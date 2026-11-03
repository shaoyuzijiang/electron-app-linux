'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const {
  UPDATE_BASE_URL,
  createUpdater,
  compareVersions,
  getPlatform,
  installerExtension,
  validateUpdateUrl,
} = require('../utils/updater');

function response(statusCode, headers, body) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  stream.statusCode = statusCode;
  stream.headers = headers || {};
  return stream;
}

function fakeNet(responses, requested) {
  return {
    request(options) {
      requested.push(options.url);
      const request = new EventEmitter();
      request.abort = () => {};
      request.end = () => {
        const next = responses.shift();
        process.nextTick(() => {
          if (next instanceof Error) request.emit('error', next);
          else request.emit('response', next);
        });
      };
      return request;
    },
  };
}

async function run() {
  assert.strictEqual(getPlatform('linux'), 'linux');
  assert.strictEqual(getPlatform('darwin'), 'macos');
  assert.strictEqual(installerExtension('linux'), 'deb');
  assert.strictEqual(installerExtension('darwin'), 'dmg');
  assert.strictEqual(compareVersions('3.100.0', '3.9.0'), 1);
  assert.strictEqual(compareVersions('3.45.100', '3.45.100'), 0);
  assert.strictEqual(compareVersions('3.43.0', '3.45.0'), -1);
  assert.strictEqual(validateUpdateUrl(`${UPDATE_BASE_URL}/api/download/1`), `${UPDATE_BASE_URL}/api/download/1`);
  for (const invalid of [
    'http://dl.liuqi92.cn:7443/api/download/1',
    'https://user:pass@dl.liuqi92.cn:7443/api/download/1',
    'https://localhost/api/download/1',
    'https://127.0.0.1/api/download/1',
    'https://[::1]/api/download/1',
    'file:///tmp/update.deb',
    'https://evil.example/api/download/1',
  ]) assert.throws(() => validateUpdateUrl(invalid));

  for (const latest of [
    { version: '3.46.0', arch: 'arm64', downloadUrl: `${UPDATE_BASE_URL}/api/download/1`, size: 10 },
    { version: '3.46.0', arch: '', downloadUrl: `${UPDATE_BASE_URL}/api/download/1`, size: 10, sha256: 'a'.repeat(64) },
    { version: '3.46.0', arch: 'x64', downloadUrl: `${UPDATE_BASE_URL}/api/download/1`, size: 10, sha256: 'a'.repeat(64) },
  ]) {
    const body = JSON.stringify({ code: 0, data: { updateAvailable: true, latest } });
    const invalidUpdater = createUpdater({
      platform: 'linux',
      arch: 'arm64',
      app: { getVersion: () => '3.45.100' },
      net: fakeNet([response(200, { 'content-length': String(Buffer.byteLength(body)) }, body)], []),
      shell: {},
    });
    const result = await invalidUpdater.checkUpdate();
    assert.strictEqual(result.success, false, '缺少哈希、空架构或错误架构必须被拒绝');
  }

  for (const version of ['3.45.100', '3.43.112']) {
    const body = JSON.stringify({ code: 0, data: { updateAvailable: true, latest: {
      version, arch: 'arm64', downloadUrl: `${UPDATE_BASE_URL}/api/download/1`, size: 10, sha256: 'a'.repeat(64),
    } } });
    const staleUpdater = createUpdater({
      platform: 'linux', arch: 'arm64', app: { getVersion: () => '3.45.100' },
      net: fakeNet([response(200, {}, body)], []), shell: {},
    });
    assert.strictEqual((await staleUpdater.checkUpdate()).success, false, '同版/旧版安装包不得进入更新流程');
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wemeet-updater-test-'));
  const requested = [];
  const packageBytes = Buffer.from('local fake deb package');
  const digest = crypto.createHash('sha256').update(packageBytes).digest('hex');
  const downloadUrl = `${UPDATE_BASE_URL}/api/download/27`;
  const checkBody = JSON.stringify({
    code: 0,
    data: {
      updateAvailable: true,
      currentVersion: '3.45.100',
      latest: {
        id: 27,
        version: '3.46.0',
        arch: 'arm64',
        downloadUrl,
        size: packageBytes.length,
        sha256: digest,
        note: 'local test',
      },
    },
  });
  const responses = [
    response(200, { 'content-length': String(Buffer.byteLength(checkBody)) }, checkBody),
    response(200, {
      'content-length': String(packageBytes.length),
      'content-disposition': 'attachment; filename="../../untrusted.sh"',
    }, packageBytes),
  ];
  const shown = [];
  const opened = [];
  const updater = createUpdater({
    platform: 'linux',
    arch: 'arm64',
    app: { getVersion: () => '3.45.100', getPath: (name) => { assert.strictEqual(name, 'temp'); return root; } },
    net: fakeNet(responses, requested),
    shell: {
      showItemInFolder: (file) => shown.push(file),
      openPath: async (file) => { opened.push(file); return ''; },
    },
    randomBytes: () => Buffer.alloc(24, 7),
  });

  const checked = await updater.checkUpdate();
  assert.strictEqual(checked.success, true);
  assert.strictEqual(checked.updateAvailable, true);
  assert(/^[a-f0-9]{48}$/.test(checked.latest.taskId), '检查结果必须包含不可猜测任务引用');
  assert.strictEqual(new URL(requested[0]).origin, new URL(UPDATE_BASE_URL).origin);
  assert.strictEqual(new URL(requested[0]).searchParams.get('platform'), 'linux');
  assert.strictEqual(new URL(requested[0]).searchParams.get('arch'), 'arm64');

  const rejected = await updater.downloadUpdate({ ...checked.latest, taskId: 'forged' });
  assert.strictEqual(rejected.success, false, '伪造任务引用必须被拒绝');

  const downloaded = await updater.downloadUpdate({
    taskId: checked.latest.taskId,
    downloadUrl: 'https://evil.example/payload',
    size: 1,
  });
  assert.strictEqual(downloaded.success, true);
  assert.strictEqual(requested[1], downloadUrl, '下载必须使用主进程保存的服务端结果');
  assert.strictEqual(path.dirname(downloaded.filePath), path.join(root, 'app-update'));
  assert.strictEqual(path.extname(downloaded.filePath), '.deb');
  assert(!downloaded.filePath.includes('untrusted.sh'), '服务端文件名不能影响落盘路径');
  assert.deepStrictEqual(fs.readFileSync(downloaded.filePath), packageBytes);

  const arbitrary = await updater.openInstaller(path.join(root, 'attacker.deb'));
  assert.strictEqual(arbitrary.success, false, '任意 Renderer 路径必须被拒绝');
  const openedTrusted = await updater.openInstaller(downloaded.filePath);
  assert.deepStrictEqual(openedTrusted, { success: true, action: 'show-item' });
  assert.deepStrictEqual(shown, [downloaded.filePath]);
  assert.deepStrictEqual(opened, [], 'Linux 不应执行或直接打开 DEB');
  assert.strictEqual((await updater.openInstaller(downloaded.filePath)).success, false, '安装包只可定位一次');

  const winBody = JSON.stringify({ code: 0, data: { updateAvailable: true, latest: {
    version: '3.46.0', arch: 'x64', downloadUrl, size: packageBytes.length, sha256: digest,
  } } });
  const winUpdater = createUpdater({
    platform: 'win32', arch: 'x64',
    app: { getVersion: () => '3.45.100', getPath: () => root },
    net: fakeNet([response(200, {}, winBody), response(200, {}, packageBytes)], []),
    shell: { showItemInFolder: (file) => shown.push(file), openPath: async (file) => { opened.push(file); return ''; } },
  });
  const winChecked = await winUpdater.checkUpdate();
  const winDownloaded = await winUpdater.downloadUpdate({ taskId: winChecked.latest.taskId });
  assert.strictEqual(winDownloaded.openAction, 'show-item');
  fs.writeFileSync(winDownloaded.filePath, Buffer.alloc(packageBytes.length, 0));
  assert.strictEqual((await winUpdater.openInstaller(winDownloaded.filePath)).success, false, '同大小篡改文件须拒绝');
  assert.deepStrictEqual(opened, [], 'Windows 下载包不得自动执行');

  const redirected = createUpdater({
    platform: 'linux',
    arch: 'arm64',
    app: { getVersion: () => '3.45.100' },
    net: fakeNet([response(302, { location: 'http://127.0.0.1/payload' })], []),
    shell: {},
  });
  const redirectResult = await redirected.checkUpdate();
  assert.strictEqual(redirectResult.success, false);
  assert.match(redirectResult.message, /HTTPS|本地|内网/);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('更新器安全校验通过：固定 HTTPS 域名、重定向复验、任务防伪、DEB 安全落盘与仅显示文件策略均通过');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
