/**
 * 按小时滚动的文件日志模块（支持 Windows 和 macOS）
 * 日志写入 userData/demologs/ 目录，每小时生成一个文件
 * 文件名格式: app_YYYY-MM-DD_HH.log
 *
 * Windows: C:\Users\<用户>\AppData\Roaming\tencent-meeting-sdk-demo\demologs\
 * macOS:   ~/Library/Application Support/tencent-meeting-sdk-demo/demologs/
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR_NAME = 'demologs';
const LOG_PREFIX = 'app_';
const LOG_SUFFIX = '.log';

let logDir = null;
let currentHour = null;
let currentStream = null;
let installed = false;

/**
 * 获取本地时区的时间戳字符串（格式: YYYY-MM-DDTHH:mm:ss.SSSZ，Z 为时区偏移）
 */
function toLocalISOString(date) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const offsetStr = `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${offsetStr}`;
}

/**
 * 获取当前小时标识（精确到小时，本地时区）
 */
function getHourKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}_${h}`;
}

/**
 * 获取日志文件名
 */
function getLogFileName(hourKey) {
  return `${LOG_PREFIX}${hourKey}${LOG_SUFFIX}`;
}

/**
 * 获取日志目录路径（延迟获取，确保 app 已 ready）
 */
function getLogDir() {
  if (!logDir) {
    const { app } = require('electron');
    logDir = path.join(app.getPath('userData'), LOG_DIR_NAME);
  }
  return logDir;
}

/**
 * 确保日志目录存在
 */
function ensureLogDir() {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 获取当前小时对应的写入流（跨小时自动切换）
 */
function getStream() {
  const hourKey = getHourKey();
  if (hourKey !== currentHour || !currentStream) {
    // 关闭旧流
    if (currentStream) {
      currentStream.end();
      currentStream = null;
    }
    ensureLogDir();
    const dir = getLogDir();
    const logFile = path.join(dir, getLogFileName(hourKey));
    currentStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf8' });
    currentHour = hourKey;

    // 写入分隔线标识新进程启动
    currentStream.write(`\n${'='.repeat(60)}\n[${toLocalISOString(new Date())}] Process started (PID: ${process.pid}, Platform: ${process.platform}/${process.arch})\n${'='.repeat(60)}\n`);
  }
  return currentStream;
}

/**
 * 格式化日志行
 */
function formatLine(level, args) {
  const timestamp = toLocalISOString(new Date());
  const msg = args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }).join(' ');
  return `[${timestamp}] [${level}] ${msg}\n`;
}

/**
 * 写入日志文件
 */
function writeLog(level, args) {
  try {
    const stream = getStream();
    stream.write(formatLine(level, args));
  } catch {
    // 日志写入失败时静默忽略，避免无限递归
  }
}

/**
 * 清理过期日志文件（保留最近 7 天）
 */
function cleanOldLogs() {
  try {
    ensureLogDir();
    const dir = getLogDir();
    const files = fs.readdirSync(dir);
    const now = Date.now();
    const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天

    for (const file of files) {
      if (!file.startsWith(LOG_PREFIX) || !file.endsWith(LOG_SUFFIX)) continue;
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > MAX_AGE) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // 忽略无法读取的文件
      }
    }
  } catch {
    // 忽略清理失败
  }
}

/**
 * 关闭日志流（应用退出时调用）
 */
function closeLog() {
  if (currentStream) {
    try {
      currentStream.write(formatLine('INFO', ['Application exiting']));
      currentStream.end();
    } catch {
      // 忽略关闭失败
    }
    currentStream = null;
    currentHour = null;
  }
}

/**
 * 安装日志拦截：劫持 console.log/warn/error，同时写文件
 * 必须在 app.ready 之后调用
 */
function install() {
  if (installed) return;
  installed = true;

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = function (...args) {
    origLog.apply(console, args);
    writeLog('INFO', args);
  };

  console.warn = function (...args) {
    origWarn.apply(console, args);
    writeLog('WARN', args);
  };

  console.error = function (...args) {
    origError.apply(console, args);
    writeLog('ERROR', args);
  };

  // 捕获未处理的异常和 Promise 拒绝
  process.on('uncaughtException', (err) => {
    writeLog('FATAL', ['Uncaught Exception:', err]);
  });
  process.on('unhandledRejection', (reason) => {
    writeLog('ERROR', ['Unhandled Rejection:', reason instanceof Error ? reason : String(reason)]);
  });

  // 启动时清理过期日志
  cleanOldLogs();

  // 每小时检查一次清理过期日志
  setInterval(cleanOldLogs, 60 * 60 * 1000);

  // 应用退出时关闭流
  try {
    const { app } = require('electron');
    app.on('before-quit', closeLog);
  } catch {
    // 非 Electron 环境
  }
}

module.exports = { install, closeLog };
