'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SDK_ARCH,
  SDK_VERSION,
  assertArm64Elf,
  assertSafeArchiveMember,
  assertSafeSymlinks,
  collectExecutableElfFiles,
  isPathInside,
  resolveArchiveLink,
  sha256File
} = require('./sdk-utils');

const projectRoot = path.resolve(__dirname, '..');
const packagePath = process.argv[2] || process.env.TMSDK_PACKAGE_PATH;
const expectedArchiveName = `TMSDK_0300000000_${SDK_VERSION}_${SDK_ARCH}_default.publish.tar.gz`;
const expectedRoot = expectedArchiveName.replace(/\.tar\.gz$/, '');
const sdkDestination = path.join(projectRoot, 'sdk', 'linux-arm64', SDK_VERSION);
const nativeDestination = path.join(projectRoot, 'native', 'wemeet.cpp');

function runTar(argumentsList) {
  const result = spawnSync('tar', argumentsList, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`tar 命令失败：${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout;
}

function isSelected(member) {
  return member === `${expectedRoot}/SDK/libwemeetsdk.so`
    || member === `${expectedRoot}/SDK/libwemeet_base.so`
    || member === `${expectedRoot}/SDK/saas_sdk_env.json`
    || member === `${expectedRoot}/Electron_Demo/wemeet_sdk/wemeet.cpp`
    || member === `${expectedRoot}/Electron_Demo/output/linux/wemeet_electron_sdk.node`
    || member.startsWith(`${expectedRoot}/SDK/include/`)
    || member.startsWith(`${expectedRoot}/SDK/Release/`);
}

function inspectArchive() {
  const members = runTar(['-tzf', packagePath]).split(/\r?\n/).filter(Boolean);
  if (!members.length) throw new Error('SDK 压缩包为空');
  for (const member of members) assertSafeArchiveMember(member, expectedRoot);
  const selected = members.filter(isSelected);
  for (const required of [
    `${expectedRoot}/SDK/libwemeetsdk.so`,
    `${expectedRoot}/SDK/libwemeet_base.so`,
    `${expectedRoot}/SDK/saas_sdk_env.json`,
    `${expectedRoot}/Electron_Demo/wemeet_sdk/wemeet.cpp`,
    `${expectedRoot}/Electron_Demo/output/linux/wemeet_electron_sdk.node`
  ]) {
    if (!selected.includes(required)) throw new Error(`SDK 压缩包缺少必需文件：${required}`);
  }

  const verbose = runTar(['-tvzf', packagePath]).split(/\r?\n/).filter(Boolean);
  for (const line of verbose) {
    if (!line.startsWith('l')) continue;
    const start = line.indexOf(`${expectedRoot}/`);
    if (start < 0) throw new Error(`无法解析压缩包符号链接：${line}`);
    const arrow = line.indexOf(' -> ', start);
    if (arrow < 0) throw new Error(`无法解析压缩包符号链接目标：${line}`);
    const member = line.slice(start, arrow).trim();
    if (!isSelected(member)) continue;
    const target = line.slice(arrow + 4).trim();
    const resolved = resolveArchiveLink(member, target, expectedRoot);
    if (!isSelected(resolved)) throw new Error(`符号链接目标不在安全导入白名单中：${member}`);
  }
  return selected;
}

function sanitizeNativeBridge(bridgePath) {
  const source = fs.readFileSync(bridgePath, 'utf8');
  const unsafeLog = 'vec_args[i] = buf;\n    log(buf);';
  if (!source.includes(unsafeLog)) throw new Error('无法定位官方桥接源码中的敏感初始化参数日志');
  fs.writeFileSync(bridgePath, source.replace(unsafeLog, 'vec_args[i] = buf;\n    if (i != 1) log(buf);  // SDK Token 永不写入桥接日志。'), { mode: 0o644 });
}

function writeManifest(sdkRoot, upstreamBridgeSha256) {
  const files = [
    'libwemeetsdk.so',
    'libwemeet_base.so',
    'saas_sdk_env.json',
    'prebuilt/wemeet_electron_sdk.node',
    'native/wemeet.cpp'
  ].map((relativePath) => {
    const absolutePath = relativePath === 'native/wemeet.cpp' ? nativeDestination : path.join(sdkRoot, relativePath);
    return { path: relativePath, sha256: sha256File(absolutePath) };
  });
  const manifest = {
    sdkVersion: SDK_VERSION,
    cpuArchitecture: SDK_ARCH,
    sourcePackage: path.basename(packagePath),
    importedAt: new Date().toISOString(),
    files,
    executableElfFiles: collectExecutableElfFiles(path.join(sdkRoot, 'Release')),
    nativeBridge: {
      path: 'native/wemeet.cpp',
      sourceSdkVersion: SDK_VERSION,
      upstreamSha256: upstreamBridgeSha256,
      localSha256: sha256File(nativeDestination),
      securityPatch: '禁止记录 InitWemeetSDK 的 SDK Token 参数'
    }
  };
  fs.writeFileSync(path.join(sdkRoot, 'sdk-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
}

function main() {
  if (!packagePath) throw new Error('请通过 TMSDK_PACKAGE_PATH 或第一个命令行参数提供 SDK 压缩包路径');
  if (path.basename(packagePath) !== expectedArchiveName) throw new Error(`SDK 包名不匹配，期望：${expectedArchiveName}`);
  if (!fs.statSync(packagePath).isFile()) throw new Error('SDK 包路径不是普通文件');
  if (fs.existsSync(sdkDestination) && fs.readdirSync(sdkDestination).some((name) => name !== '.gitkeep')) throw new Error(`目标 SDK 目录已存在且非空：${sdkDestination}`);
  if (fs.existsSync(nativeDestination)) throw new Error(`拒绝覆盖已有原生桥接源码：${nativeDestination}`);

  const selected = inspectArchive();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tmsdk-import-'));
  try {
    runTar(['-xzf', packagePath, '-C', tempRoot, ...selected]);
    const extractedRoot = path.join(tempRoot, expectedRoot);
    const extractedSdk = path.join(extractedRoot, 'SDK');
    if (!isPathInside(tempRoot, extractedSdk)) throw new Error('提取后的 SDK 目录不安全');
    assertSafeSymlinks(extractedSdk);
    assertArm64Elf(path.join(extractedSdk, 'libwemeetsdk.so'));
    assertArm64Elf(path.join(extractedSdk, 'libwemeet_base.so'));
    assertArm64Elf(path.join(extractedRoot, 'Electron_Demo', 'output', 'linux', 'wemeet_electron_sdk.node'));

    fs.mkdirSync(path.dirname(sdkDestination), { recursive: true });
    if (fs.existsSync(sdkDestination)) fs.rmSync(sdkDestination, { recursive: true, force: true });
    fs.renameSync(extractedSdk, sdkDestination);
    fs.mkdirSync(path.join(sdkDestination, 'prebuilt'), { recursive: true });
    fs.renameSync(path.join(extractedRoot, 'Electron_Demo', 'output', 'linux', 'wemeet_electron_sdk.node'), path.join(sdkDestination, 'prebuilt', 'wemeet_electron_sdk.node'));
    const extractedBridge = path.join(extractedRoot, 'Electron_Demo', 'wemeet_sdk', 'wemeet.cpp');
    const upstreamBridgeSha256 = sha256File(extractedBridge);
    fs.mkdirSync(path.dirname(nativeDestination), { recursive: true });
    fs.renameSync(extractedBridge, nativeDestination);
    sanitizeNativeBridge(nativeDestination);
    writeManifest(sdkDestination, upstreamBridgeSha256);
    console.info(`SDK ${SDK_VERSION} 已安全导入至 ${sdkDestination}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`SDK 导入失败：${error.message}`);
  process.exitCode = 1;
}
