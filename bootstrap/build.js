// 统一构建入口：注入 BUILD_DATE 环境变量后调用 electron-builder
// 用法: node bootstrap/build.js [electron-builder 参数...]
//   环境变量 SKIP_SIGN=1 可跳过签名步骤
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const now = new Date();
const date =
  now.getFullYear().toString() +
  String(now.getMonth() + 1).padStart(2, '0') +
  String(now.getDate()).padStart(2, '0');

process.env.BUILD_DATE = date;

// macOS 签名 identity（与 package.json build.mac.identity 一致）
const SIGN_IDENTITY = 'Apple Development: liuqi92@foxmail.com (5Y6WN3D7WG)';
const isMacBuild = process.argv.some(a => a.includes('mac') || a.includes('arm64') || a.includes('x64'));
const skipSign = process.env.SKIP_SIGN === '1' || !isMacBuild;

// electron-builder 内置签名会因 TMSDK.framework 文件数过多（6000+）触发 EMFILE，
// 改为先无签名打包，再手动 codesign --deep 签名整个 .app
if (isMacBuild && !skipSign) {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  console.log('⚠️  已禁用 electron-builder 内置签名（避免 EMFILE），打包后手动 codesign');
}

const args = process.argv.slice(2);
const child = spawn('electron-builder', args, {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

child.on('close', (code) => {
  if (code !== 0) {
    process.exit(code);
  }

  // macOS 打包后手动签名
  if (isMacBuild && !skipSign) {
    const isArm64 = process.argv.some(a => a.includes('arm64'));
    // electron-builder 输出目录：arm64 -> mac-arm64，x64 -> mac
    const archDir = isArm64 ? 'mac-arm64' : 'mac';
    const appPath = path.join(__dirname, '..', 'dist', archDir, '腾讯会议SDK Demo.app');

    if (!fs.existsSync(appPath)) {
      console.error(`❌ 找不到 .app: ${appPath}，跳过签名`);
      process.exit(1);
    }

    console.log(`\n🔐 开始签名: ${appPath}`);
    const signResult = spawnSync('codesign', [
      '--deep',
      '--force',
      '--options', 'runtime',
      '--entitlements', path.join(__dirname, '..', 'entitlements.mac.plist'),
      '--sign', SIGN_IDENTITY,
      appPath,
    ], { stdio: 'inherit' });

    if (signResult.status !== 0) {
      console.error('❌ 签名失败');
      process.exit(signResult.status || 1);
    }

    console.log('✅ 签名完成，验证中...');
    spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
    console.log('✅ 验证通过');
  }

  process.exit(0);
});
