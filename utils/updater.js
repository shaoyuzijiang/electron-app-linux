'use strict';

/**
 * 应用更新模块（主进程）。更新元数据只来自固定 HTTPS 分发域名，Renderer
 * 只能持有一次检查签发的随机任务引用，不能指定下载地址或要打开的本地文件。
 */
const crypto = require('crypto');
const fs = require('fs');
const nodeNet = require('net');
const path = require('path');

const UPDATE_BASE_URL = 'https://dl.liuqi92.cn:7443';
const UPDATE_ALLOWED_ORIGINS = Object.freeze([new URL(UPDATE_BASE_URL).origin]);
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const UPDATE_TASK_TTL_MS = 60 * 60 * 1000;

function getPlatform(platform = process.platform) {
  switch (platform) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    case 'linux': return 'linux';
    default: return platform;
  }
}

function getArch(arch = process.arch) {
  return arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : arch;
}

function isPrivateIp(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (nodeNet.isIPv4(normalized)) {
    const octets = normalized.split('.').map(Number);
    return octets[0] === 10
      || octets[0] === 127
      || octets[0] === 0
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
  }
  if (nodeNet.isIPv6(normalized)) {
    return normalized === '::' || normalized === '::1'
      || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('fe8') || normalized.startsWith('fe9')
      || normalized.startsWith('fea') || normalized.startsWith('feb')
      || normalized.startsWith('::ffff:');
  }
  return normalized === 'localhost' || normalized.endsWith('.localhost');
}

function validateUpdateUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) throw new Error('更新地址无效');
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('更新地址无效'); }
  if (parsed.protocol !== 'https:') throw new Error('更新地址必须使用 HTTPS');
  if (parsed.username || parsed.password) throw new Error('更新地址不允许包含用户信息');
  if (isPrivateIp(parsed.hostname)) throw new Error('更新地址不允许指向本地或内网');
  if (!UPDATE_ALLOWED_ORIGINS.includes(parsed.origin)) throw new Error('更新地址不在允许的分发域名内');
  return parsed.href;
}

function headerValue(headers, name) {
  if (!headers) return '';
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function installerExtension(platform) {
  if (platform === 'linux') return 'deb';
  if (platform === 'win32') return 'exe';
  return 'dmg';
}

function compareVersions(left, right) {
  const segments = (version) => version.split(/[.-]/);
  const a = segments(left);
  const b = segments(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] || '0';
    const y = b[index] || '0';
    const result = /^\d+$/.test(x) && /^\d+$/.test(y)
      ? (BigInt(x) > BigInt(y) ? 1 : BigInt(x) < BigInt(y) ? -1 : 0)
      : (x > y ? 1 : x < y ? -1 : 0);
    if (result) return result;
  }
  return 0;
}

function createUpdater(options = {}) {
  const runtimePlatform = options.platform || process.platform;
  const runtimeArch = options.arch || process.arch;
  const dependencies = {
    app: options.app,
    net: options.net,
    shell: options.shell,
    now: options.now || Date.now,
    randomBytes: options.randomBytes || crypto.randomBytes,
  };
  let currentDownload = false;
  let checkedTask = null;
  let trustedDownload = null;

  function requireDependency(name) {
    if (!dependencies[name]) throw new Error(`更新模块缺少依赖: ${name}`);
    return dependencies[name];
  }

  function openResponse(rawUrl, redirectCount = 0) {
    let safeUrl;
    try { safeUrl = validateUpdateUrl(rawUrl); } catch (error) { return Promise.reject(error); }
    if (redirectCount > MAX_REDIRECTS) return Promise.reject(new Error('更新请求重定向次数过多'));
    const electronNet = requireDependency('net');

    return new Promise((resolve, reject) => {
      const request = electronNet.request({ method: 'GET', url: safeUrl, redirect: 'manual' });
      let settled = false;
      const timeout = setTimeout(() => finish(new Error('请求超时')), 15000);

      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error); else resolve(value);
      }

      function follow(target) {
        if (settled) return;
        let nextUrl;
        try {
          nextUrl = validateUpdateUrl(new URL(target, safeUrl).href);
        } catch (error) {
          finish(error);
          try { request.abort(); } catch {}
          return;
        }
        settled = true;
        clearTimeout(timeout);
        try { request.abort(); } catch {}
        openResponse(nextUrl, redirectCount + 1).then(resolve, reject);
      }

      request.on('redirect', (_statusCode, _method, redirectUrl) => follow(redirectUrl));
      request.on('response', (response) => {
        const statusCode = Number(response.statusCode);
        if (statusCode >= 300 && statusCode < 400) {
          const location = headerValue(response.headers, 'location');
          if (typeof response.resume === 'function') response.resume();
          if (!location) finish(new Error(`重定向响应缺少地址 (HTTP ${statusCode})`));
          else follow(location);
          return;
        }
        finish(null, { response, url: safeUrl });
      });
      request.on('error', (error) => finish(error));
      request.end();
    });
  }

  async function getJson(rawUrl) {
    const { response } = await openResponse(rawUrl);
    if (Number(response.statusCode) !== 200) throw new Error(`服务返回异常 (HTTP ${response.statusCode})`);
    return new Promise((resolve, reject) => {
      const chunks = [];
      let received = 0;
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        if (error) reject(error); else resolve(value);
      };
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_JSON_BYTES) {
          if (typeof response.destroy === 'function') response.destroy();
          finish(new Error('更新响应数据过大'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', (error) => finish(error));
      response.on('end', () => {
        if (done) return;
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { finish(new Error('响应不是合法 JSON')); }
      });
    });
  }

  function validateVersionInfo(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('服务端版本信息无效');
    const version = typeof value.version === 'string' ? value.version.trim() : '';
    if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version)) throw new Error('服务端版本号无效');
    const size = Number(value.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_DOWNLOAD_BYTES) throw new Error('安装包大小无效');
    const downloadUrl = validateUpdateUrl(value.downloadUrl);
    const sha256 = typeof value.sha256 === 'string' ? value.sha256.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('安装包缺少有效的 SHA-256，已拒绝更新');
    const arch = typeof value.arch === 'string' ? value.arch.trim() : '';
    if (!arch || (arch !== 'universal' && getArch(arch) !== getArch(runtimeArch))) {
      throw new Error('安装包架构与当前设备不兼容');
    }
    return {
      id: Number.isSafeInteger(Number(value.id)) ? Number(value.id) : null,
      version,
      arch,
      downloadUrl,
      size,
      sha256,
      note: typeof value.note === 'string' ? value.note.slice(0, 65536) : '',
      releaseDate: typeof value.releaseDate === 'string' ? value.releaseDate.slice(0, 64) : '',
    };
  }

  async function checkUpdate() {
    const app = requireDependency('app');
    checkedTask = null;
    trustedDownload = null;
    const checkUrl = new URL('/api/check-update', UPDATE_BASE_URL);
    checkUrl.searchParams.set('platform', getPlatform(runtimePlatform));
    checkUrl.searchParams.set('version', app.getVersion());
    checkUrl.searchParams.set('arch', getArch(runtimeArch));

    let payload;
    try { payload = await getJson(checkUrl.href); }
    catch (error) { return { success: false, message: `网络错误: ${error.message}` }; }
    if (!payload || payload.code !== 0) {
      return { success: false, message: (payload && payload.message) || `服务返回异常 (code=${payload && payload.code})` };
    }
    const data = payload.data || {};
    if (!data.updateAvailable) {
      return { success: true, updateAvailable: false, currentVersion: data.currentVersion || app.getVersion(), latest: null };
    }
    let latest;
    try { latest = validateVersionInfo(data.latest); }
    catch (error) { return { success: false, message: error.message }; }
    if (compareVersions(latest.version, app.getVersion()) <= 0) {
      return { success: false, message: '服务端提供的版本不高于当前版本，已拒绝更新' };
    }
    const taskId = dependencies.randomBytes(24).toString('hex');
    checkedTask = { taskId, expiresAt: dependencies.now() + UPDATE_TASK_TTL_MS, versionInfo: latest };
    return {
      success: true,
      updateAvailable: true,
      currentVersion: data.currentVersion || app.getVersion(),
      latest: { ...latest, taskId },
    };
  }

  function getCheckedVersion(rendererInfo) {
    const taskId = rendererInfo && typeof rendererInfo.taskId === 'string' ? rendererInfo.taskId : '';
    if (!checkedTask || checkedTask.expiresAt < dependencies.now() || taskId !== checkedTask.taskId) {
      throw new Error('更新任务无效或已过期，请重新检查更新');
    }
    return { ...checkedTask.versionInfo, taskId: checkedTask.taskId };
  }

  async function downloadUpdate(rendererInfo, onProgress, progressWindow) {
    if (currentDownload) return { success: false, message: '已有下载任务进行中' };
    let versionInfo;
    try { versionInfo = getCheckedVersion(rendererInfo); }
    catch (error) { return { success: false, message: error.message }; }
    currentDownload = true;
    trustedDownload = null;

    const app = requireDependency('app');
    const extension = installerExtension(runtimePlatform);
    const safeVersion = versionInfo.version.replace(/[^0-9A-Za-z._-]/g, '_');
    const filename = `TMSDK-Demo-${safeVersion}-${getArch(runtimeArch)}-${versionInfo.taskId.slice(0, 12)}.${extension}`;
    const saveDir = path.resolve(app.getPath('temp'), 'app-update');
    const savePath = path.resolve(saveDir, filename);
    if (path.dirname(savePath) !== saveDir) {
      currentDownload = false;
      return { success: false, message: '安装包保存路径无效' };
    }

    try {
      fs.mkdirSync(saveDir, { recursive: true, mode: 0o700 });
      const dirStat = fs.lstatSync(saveDir);
      if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('安装包目录不安全');
      try { fs.unlinkSync(savePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const { response } = await openResponse(versionInfo.downloadUrl);
      if (Number(response.statusCode) !== 200) throw new Error(`下载失败 (HTTP ${response.statusCode})`);
      const contentLengthText = headerValue(response.headers, 'content-length');
      if (contentLengthText) {
        const contentLength = Number(contentLengthText);
        if (!Number.isSafeInteger(contentLength) || contentLength !== versionInfo.size || contentLength > MAX_DOWNLOAD_BYTES) {
          throw new Error('安装包响应大小与更新信息不一致');
        }
      }

      const downloadedDigest = await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(savePath, { flags: 'wx', mode: 0o600 });
        const hash = crypto.createHash('sha256');
        let received = 0;
        let lastEmit = 0;
        let done = false;
        const cleanup = () => { try { fs.unlinkSync(savePath); } catch {} };
        const finish = (error, value) => {
          if (done) return;
          done = true;
          if (error) {
            file.destroy();
            cleanup();
            reject(error);
          } else {
            resolve(value);
          }
        };
        const emitProgress = (force) => {
          const now = dependencies.now();
          if (!force && now - lastEmit < 300) return;
          lastEmit = now;
          const progress = {
            received,
            total: versionInfo.size,
            percent: Math.min(100, Math.floor((received / versionInfo.size) * 100)),
          };
          try { if (onProgress) onProgress(progress); } catch {}
          if (progressWindow && !progressWindow.isDestroyed()) progressWindow.webContents.send('app-update-progress', progress);
        };
        response.on('data', (chunk) => {
          if (done) return;
          received += chunk.length;
          if (received > versionInfo.size || received > MAX_DOWNLOAD_BYTES) {
            if (typeof response.destroy === 'function') response.destroy();
            finish(new Error('安装包超过声明大小'));
            return;
          }
          hash.update(chunk);
          if (!file.write(chunk) && typeof response.pause === 'function') {
            response.pause();
            file.once('drain', () => { if (typeof response.resume === 'function') response.resume(); });
          }
          emitProgress(false);
        });
        response.on('error', (error) => finish(new Error(`下载中断: ${error.message}`)));
        file.on('error', (error) => finish(new Error(`写入安装包失败: ${error.message}`)));
        response.on('end', () => {
          if (done) return;
          if (received !== versionInfo.size) {
            finish(new Error(`下载不完整 (${received}/${versionInfo.size})`));
            return;
          }
          const digest = hash.digest('hex');
          if (digest !== versionInfo.sha256) {
            finish(new Error('安装包 SHA-256 校验失败'));
            return;
          }
          file.end(() => { emitProgress(true); finish(null, digest); });
        });
      });

      const completedStat = fs.lstatSync(savePath);
      if (!completedStat.isFile() || completedStat.isSymbolicLink()) throw new Error('安装包文件类型无效');
      trustedDownload = {
        filePath: savePath,
        extension,
        taskId: versionInfo.taskId,
        digest: downloadedDigest,
        dev: completedStat.dev,
        ino: completedStat.ino,
        size: completedStat.size,
        mtimeMs: completedStat.mtimeMs,
      };
      return {
        success: true,
        filePath: savePath,
        version: versionInfo.version,
        openAction: 'show-item',
      };
    } catch (error) {
      try { fs.unlinkSync(savePath); } catch {}
      return { success: false, message: error.message };
    } finally {
      currentDownload = false;
    }
  }

  async function openInstaller(rendererPath) {
    const app = requireDependency('app');
    const electronShell = requireDependency('shell');
    const saveDir = path.resolve(app.getPath('temp'), 'app-update');
    const expectedExtension = `.${installerExtension(runtimePlatform)}`;
    const requestedPath = typeof rendererPath === 'string' ? path.resolve(rendererPath) : '';
    if (!trustedDownload || requestedPath !== trustedDownload.filePath
      || path.dirname(requestedPath) !== saveDir || path.extname(requestedPath).toLowerCase() !== expectedExtension) {
      return { success: false, message: '拒绝打开未受信任的安装包' };
    }
    let stat;
    try {
      const dirStat = fs.lstatSync(saveDir);
      stat = fs.lstatSync(requestedPath);
      if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('unsafe directory');
    } catch { return { success: false, message: '安装包不存在或目录不安全' }; }
    if (!stat.isFile() || stat.isSymbolicLink()
      || stat.dev !== trustedDownload.dev || stat.ino !== trustedDownload.ino
      || stat.size !== trustedDownload.size || stat.mtimeMs !== trustedDownload.mtimeMs) {
      return { success: false, message: '安装包文件已被替换' };
    }

    try {
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(requestedPath)) hash.update(chunk);
      if (hash.digest('hex') !== trustedDownload.digest) {
        trustedDownload = null;
        return { success: false, message: '安装包内容已变化，请重新下载' };
      }
      // 更新元数据和安装包来自同一分发服务；未独立验证发布签名，不自动执行。
      electronShell.showItemInFolder(requestedPath);
      trustedDownload = null;
      return { success: true, action: 'show-item' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  return { checkUpdate, downloadUpdate, openInstaller };
}

let defaultUpdater = null;
function getDefaultUpdater() {
  if (!defaultUpdater) {
    const electron = require('electron');
    defaultUpdater = createUpdater({ app: electron.app, net: electron.net, shell: electron.shell });
  }
  return defaultUpdater;
}

module.exports = {
  UPDATE_BASE_URL,
  UPDATE_ALLOWED_ORIGINS,
  MAX_JSON_BYTES,
  MAX_DOWNLOAD_BYTES,
  getPlatform,
  getArch,
  compareVersions,
  validateUpdateUrl,
  installerExtension,
  createUpdater,
  checkUpdate: (...args) => getDefaultUpdater().checkUpdate(...args),
  downloadUpdate: (...args) => getDefaultUpdater().downloadUpdate(...args),
  openInstaller: (...args) => getDefaultUpdater().openInstaller(...args),
};
