// electron-builder afterPack 钩子（仅 macOS 生效，见 package.json build.mac.afterPack）
//
// 执行时机：.app 组装完成后、DMG 构建之前 —— 因此这里拷入的 Framework 和
// 签名结果都会包含在最终 DMG 中。
//
// 职责：
//   1. 从 wemeet_sdk/mac/Frameworks/<arch>/ 拷贝单架构 TMSDK.framework 到
//      .app/Contents/Frameworks/（替代 extraFiles + output/mac 暂存方案，
//      消除打包过程中的二次拷贝，且只拷目标架构、体积减半）
//   2. 手动 codesign 签名（electron-builder 内置签名在 6000+ 文件的
//      framework 上会触发 EMFILE；且签名必须在 DMG 构建前完成，
//      否则 DMG 内是未签名 .app，分发到其他 Mac 会提示"已损坏"）
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SIGN_IDENTITY = 'Apple Development: liuqi92@foxmail.com (5Y6WN3D7WG)';

/**
 * 探测目标架构
 * 优先级：TMSDK_ARCH 环境变量（build.js 注入） > .app 主程序实际架构 > 当前机器架构
 */
function detectArch(context, appPath) {
  const env = process.env.TMSDK_ARCH;
  if (env === 'arm64' || env === 'x64') return env;

  // 读取 .app 主程序的实际架构（最可靠）
  try {
    const macosDir = path.join(appPath, 'Contents', 'MacOS');
    const exe = fs.readdirSync(macosDir)[0];
    if (exe) {
      const r = spawnSync('lipo', ['-archs', path.join(macosDir, exe)], { encoding: 'utf-8' });
      const archs = (r.stdout || '').trim();
      if (archs.includes('arm64') && !archs.includes('x86_64')) return 'arm64';
      if (archs.includes('x86_64') && !archs.includes('arm64')) return 'x64';
    }
  } catch {}

  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

function findAppBundle(appOutDir) {
  if (!fs.existsSync(appOutDir)) return null;
  const app = fs.readdirSync(appOutDir).find((e) => e.endsWith('.app'));
  return app ? path.join(appOutDir, app) : null;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        fs.symlinkSync(fs.readlinkSync(s), d);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    } else if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = findAppBundle(context.appOutDir);
  if (!appPath) {
    throw new Error(`[afterPack] 输出目录中未找到 .app: ${context.appOutDir}`);
  }

  const arch = detectArch(context, appPath);

  // ---------- 1. 拷贝单架构 Framework（直接从 wemeet_sdk，无暂存） ----------
  // 目录名映射：x64 架构对应的源目录是 x86_64（与 update-mac-sdk.sh 的输出目录一致）
  const archDir = arch === 'x64' ? 'x86_64' : arch;
  const srcFramework = path.join(__dirname, '..', 'wemeet_sdk', 'mac', 'Frameworks', archDir, 'TMSDK.framework');
  if (!fs.existsSync(srcFramework)) {
    throw new Error(`[afterPack] 源 Framework 不存在: ${srcFramework}，请先运行 ./update-mac-sdk.sh`);
  }

  const destFramework = path.join(appPath, 'Contents', 'Frameworks', 'TMSDK.framework');
  fs.mkdirSync(path.dirname(destFramework), { recursive: true });
  if (fs.existsSync(destFramework)) {
    fs.rmSync(destFramework, { recursive: true, force: true });
  }

  console.log(`[afterPack] 拷贝 TMSDK.framework (${arch}) -> ${destFramework}`);
  copyDirSync(srcFramework, destFramework);
  console.log('[afterPack] Framework 拷贝完成');

  // ---------- 2. 签名（DMG 构建前，确保 DMG 内是已签名 .app） ----------
  if (process.env.SKIP_SIGN === '1') {
    console.log('[afterPack] SKIP_SIGN=1，跳过签名');
    return;
  }

  console.log('[afterPack] 开始签名...');
  const sign = spawnSync('codesign', [
    '--deep',
    '--force',
    '--options', 'runtime',
    '--entitlements', path.join(__dirname, '..', 'entitlements.mac.plist'),
    '--sign', SIGN_IDENTITY,
    appPath,
  ], { stdio: 'inherit' });

  if (sign.status !== 0) {
    throw new Error('[afterPack] 签名失败（可通过 SKIP_SIGN=1 跳过签名）');
  }

  console.log('[afterPack] 签名完成，验证中...');
  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  if (verify.status !== 0) {
    throw new Error('[afterPack] 签名验证失败');
  }
  console.log('[afterPack] 验证通过');
};
