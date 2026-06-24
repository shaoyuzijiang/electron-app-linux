// 统一构建入口：注入 BUILD_DATE 环境变量后调用 electron-builder
// 用法: node bootstrap/build.js [electron-builder 参数...]
const { spawn } = require('child_process');

const now = new Date();
const date =
  now.getFullYear().toString() +
  String(now.getMonth() + 1).padStart(2, '0') +
  String(now.getDate()).padStart(2, '0');

process.env.BUILD_DATE = date;

const args = process.argv.slice(2);
const child = spawn('electron-builder', args, {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

child.on('close', (code) => process.exit(code || 0));
