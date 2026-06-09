/**
 * 启动前脚本：将 TMSDK.framework 拷贝到 Electron.app 的 Frameworks 目录
 * Mac 端 SDK 运行时依赖 TMSDK.framework 位于 Electron.app/Contents/Frameworks/ 下
 */
const fs = require('fs');
const path = require('path');

function mkdir(dir) {
  try {
    fs.mkdirSync(dir, 0o755);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

function copyDir(src, dest) {
  mkdir(dest);
  const files = fs.readdirSync(src);
  for (const file of files) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    const stat = fs.lstatSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (stat.isSymbolicLink()) {
      const symlink = fs.readlinkSync(srcPath);
      try {
        fs.symlinkSync(symlink, destPath);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (process.platform === 'darwin') {
  const arch = process.arch;
  const tmsdkPath = path.join(__dirname, 'wemeet_sdk', 'mac', 'Frameworks', arch === 'arm64' ? 'arm64' : 'x64');
  const frameworkDest = path.join(
    __dirname, 'node_modules', 'electron', 'dist',
    'Electron.app', 'Contents', 'Frameworks'
  );

  if (!fs.existsSync(tmsdkPath)) {
    console.error(`SDK Framework 目录不存在: ${tmsdkPath}`);
    process.exit(1);
  }

  const files = fs.readdirSync(tmsdkPath);
  let copied = false;
  for (const filename of files) {
    if (filename.endsWith('.framework')) {
      const srcFramework = path.join(tmsdkPath, filename);
      const destFramework = path.join(frameworkDest, filename);
      // 目标已存在则跳过拷贝
      if (fs.existsSync(destFramework)) {
        console.log(`已存在，跳过: ${destFramework}`);
        continue;
      }
      console.log(`拷贝 ${srcFramework} -> ${destFramework} ...`);
      copyDir(srcFramework, destFramework);
      copied = true;
    }
  }
  if (copied) {
    console.log('SDK Framework 拷贝完成');
  } else {
    console.log('SDK Framework 已就位，无需拷贝');
  }
} else {
  console.log('非 Mac 平台，跳过 Framework 拷贝');
}
