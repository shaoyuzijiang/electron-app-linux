/**
 * 渲染进程日志拦截：劫持 console.log/warn/error，通过 IPC 转发到主进程写入文件
 * 必须在所有其他脚本之前加载
 */
(function () {
  'use strict';

  function serialize(args) {
    return args.map(function (a) {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try {
        return JSON.stringify(a);
      } catch (e) {
        return String(a);
      }
    }).join(' ');
  }

  function forward(level, args) {
    try {
      if (window.electronAPI && window.electronAPI.rendererLog) {
        window.electronAPI.rendererLog(level, serialize(args));
      }
    } catch (e) {
      // 转发失败时静默忽略
    }
  }

  var origLog = console.log;
  var origWarn = console.warn;
  var origError = console.error;

  console.log = function () {
    origLog.apply(console, arguments);
    forward('INFO', Array.prototype.slice.call(arguments));
  };

  console.warn = function () {
    origWarn.apply(console, arguments);
    forward('WARN', Array.prototype.slice.call(arguments));
  };

  console.error = function () {
    origError.apply(console, arguments);
    forward('ERROR', Array.prototype.slice.call(arguments));
  };

  // 捕获未处理的异常和 Promise 拒绝
  window.addEventListener('error', function (e) {
    forward('ERROR', ['Uncaught Error:', e.message, '(' + e.filename + ':' + e.lineno + ':' + e.colno + ')']);
  });

  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    if (reason instanceof Error) {
      forward('ERROR', ['Unhandled Rejection:', reason.stack || reason.message]);
    } else {
      forward('ERROR', ['Unhandled Rejection:', String(reason)]);
    }
  });
})();
