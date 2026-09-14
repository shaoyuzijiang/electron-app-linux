'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  SDK_VERSION,
  assertArm64Elf,
  assertSafeSymlinks,
  isPathInside,
  sha256File,
  validateManifestFiles
} = require('./sdk-utils');

const projectRoot = path.resolve(__dirname, '..');
const sdkRoot = path.join(projectRoot, 'sdk', 'linux-arm64', SDK_VERSION);
const requiredPaths = [
  'libwemeetsdk.so',
  'libwemeet_base.so',
  'saas_sdk_env.json',
  'Release',
  'prebuilt/wemeet_electron_sdk.node',
  'sdk-manifest.json'
];

function main() {
  const errors = [];
  if (!fs.existsSync(sdkRoot)) errors.push(`SDK 版本目录不存在：${sdkRoot}`);
  for (const relativePath of requiredPaths) {
    const absolutePath = path.join(sdkRoot, relativePath);
    if (!fs.existsSync(absolutePath)) errors.push(`缺少必需路径：${relativePath}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));

  for (const relativePath of ['libwemeetsdk.so', 'libwemeet_base.so', 'prebuilt/wemeet_electron_sdk.node']) {
    try { assertArm64Elf(path.join(sdkRoot, relativePath)); } catch (error) { errors.push(error.message); }
  }
  try { assertSafeSymlinks(sdkRoot); } catch (error) { errors.push(error.message); }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'sdk-manifest.json'), 'utf8'));
    if (manifest.sdkVersion !== SDK_VERSION) errors.push(`manifest SDK 版本不匹配：${manifest.sdkVersion}`);
    if (manifest.cpuArchitecture !== 'arm64') errors.push(`manifest CPU 架构不匹配：${manifest.cpuArchitecture}`);
    errors.push(...validateManifestFiles(manifest, (relativePath) => {
      const root = relativePath === 'native/wemeet.cpp' ? projectRoot : sdkRoot;
      const absolutePath = path.resolve(root, relativePath);
      if (!isPathInside(root, absolutePath)) throw new Error(`manifest 路径逃逸：${relativePath}`);
      return absolutePath;
    }));
    if (!manifest.nativeBridge || manifest.nativeBridge.sourceSdkVersion !== SDK_VERSION) errors.push('manifest 缺少原生桥接来源版本信息');
    else if (sha256File(path.join(projectRoot, 'native', 'wemeet.cpp')) !== manifest.nativeBridge.localSha256) errors.push('原生桥接本地 SHA-256 不匹配');
    for (const relativePath of manifest.executableElfFiles || []) {
      const absolutePath = path.join(sdkRoot, 'Release', relativePath);
      if (!fs.existsSync(absolutePath)) errors.push(`SDK helper 缺失：Release/${relativePath}`);
      else if ((fs.statSync(absolutePath).mode & 0o111) === 0) errors.push(`SDK helper 缺少执行权限：Release/${relativePath}`);
    }
  } catch (error) {
    errors.push(`manifest 校验失败：${error.message}`);
  }

  if (errors.length) throw new Error(errors.join('\n'));
  console.info(`SDK 校验通过：${sdkRoot}`);
}

try {
  main();
} catch (error) {
  console.error(`SDK 校验失败：\n${error.message}`);
  process.exitCode = 1;
}
