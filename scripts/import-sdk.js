'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  SDK_ARCH,
  SDK_VERSION,
  assertArm64Elf,
  assertSafeSymlinks,
  collectExecutableElfFiles,
  createSdkExtractionPlan,
  isPathInside,
  resolveArchiveLink,
  sha256File
} = require('./sdk-utils');

const projectRoot = path.resolve(__dirname, '..');
const expectedArchiveName = `TMSDK_0300000000_${SDK_VERSION}_${SDK_ARCH}_default.publish.tar.gz`;
const expectedRoot = expectedArchiveName.replace(/\.tar\.gz$/, '');
const requiredSdkPaths = Object.freeze([
  'libwemeetsdk.so',
  'libwemeet_base.so',
  'saas_sdk_env.json',
  'Release',
  'prebuilt/wemeet_electron_sdk.node',
  'sdk-manifest.json'
]);

function runTar(argumentsList, spawnImpl = spawnSync) {
  const result = spawnImpl('tar', argumentsList, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw new Error(`无法启动 tar：${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || `退出码 ${result.status}`).trim();
    throw new Error(`tar 提取失败：${detail}`);
  }
  return String(result.stdout || '');
}

function getTarVersion(spawnImpl = spawnSync) {
  const result = spawnImpl('tar', ['--version'], { encoding: 'utf8', maxBuffer: 128 * 1024 });
  if (result.error || result.status !== 0) return 'tar 版本未知';
  return String(result.stdout || result.stderr || 'tar 版本未知').split(/\r?\n/).find(Boolean)?.trim() || 'tar 版本未知';
}

function inspectArchive({ packagePath, root = expectedRoot, runTarImpl = runTar }) {
  const members = runTarImpl(['-tzf', packagePath]).split(/\r?\n/).filter(Boolean);
  if (!members.length) throw new Error('SDK 压缩包为空');
  const plan = createSdkExtractionPlan(members, root);
  const selected = new Set(plan.selectedMembers);
  const verbose = runTarImpl(['-tvzf', packagePath]).split(/\r?\n/).filter(Boolean);
  for (const line of verbose) {
    if (!line.startsWith('l')) continue;
    const start = line.indexOf(`${root}/`);
    if (start < 0) throw new Error(`无法解析压缩包符号链接：${line}`);
    const arrow = line.indexOf(' -> ', start);
    if (arrow < 0) throw new Error(`无法解析压缩包符号链接目标：${line}`);
    const member = line.slice(start, arrow).trim();
    if (!selected.has(member)) continue;
    const target = line.slice(arrow + 4).trim();
    const resolved = resolveArchiveLink(member, target, root);
    if (!selected.has(resolved)) throw new Error(`符号链接目标不在安全导入白名单中：${member}`);
  }
  return { members, plan };
}

function extractArchive({ packagePath, tempRoot, plan, runTarImpl = runTar, fsImpl = fs }) {
  if (plan.usesFallbackMemberList) {
    const memberListPath = path.join(tempRoot, '.sdk-extract-members.txt');
    fsImpl.writeFileSync(memberListPath, `${plan.extractMembers.join('\n')}\n`, { mode: 0o600 });
    runTarImpl(['-xzf', packagePath, '-C', tempRoot, '-T', memberListPath]);
    fsImpl.rmSync(memberListPath, { force: true });
    return;
  }
  runTarImpl(['-xzf', packagePath, '-C', tempRoot, ...plan.extractMembers]);
}

function sanitizeNativeBridge(bridgePath, fsImpl = fs) {
  const source = fsImpl.readFileSync(bridgePath, 'utf8');
  const unsafeLog = 'vec_args[i] = buf;\n    log(buf);';
  if (!source.includes(unsafeLog)) throw new Error('无法定位官方桥接源码中的敏感初始化参数日志');
  fsImpl.writeFileSync(bridgePath, source.replace(unsafeLog, 'vec_args[i] = buf;\n    if (i != 1) log(buf);  // SDK Token 永不写入桥接日志。'), { mode: 0o644 });
}

function writeManifest({ sdkRoot, bridgePath, sourcePackage, upstreamBridgeSha256, fsImpl = fs }) {
  const files = [
    'libwemeetsdk.so',
    'libwemeet_base.so',
    'saas_sdk_env.json',
    'prebuilt/wemeet_electron_sdk.node',
    'native/wemeet.cpp'
  ].map((relativePath) => {
    const absolutePath = relativePath === 'native/wemeet.cpp' ? bridgePath : path.join(sdkRoot, relativePath);
    return { path: relativePath, sha256: sha256File(absolutePath) };
  });
  const manifest = {
    sdkVersion: SDK_VERSION,
    cpuArchitecture: SDK_ARCH,
    sourcePackage,
    importedAt: new Date().toISOString(),
    files,
    executableElfFiles: collectExecutableElfFiles(path.join(sdkRoot, 'Release')),
    nativeBridge: {
      path: 'native/wemeet.cpp',
      sourceSdkVersion: SDK_VERSION,
      upstreamSha256: upstreamBridgeSha256,
      localSha256: sha256File(bridgePath),
      securityPatch: '禁止记录 InitWemeetSDK 的 SDK Token 参数'
    }
  };
  fsImpl.writeFileSync(path.join(sdkRoot, 'sdk-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
}

function prepareImport({ tempRoot, root, sourcePackage, fsImpl = fs }) {
  const extractedRoot = path.join(tempRoot, root);
  const sdkRoot = path.join(extractedRoot, 'SDK');
  const addonPath = path.join(extractedRoot, 'Electron_Demo', 'output', 'linux', 'wemeet_electron_sdk.node');
  const bridgePath = path.join(extractedRoot, 'Electron_Demo', 'wemeet_sdk', 'wemeet.cpp');
  if (!isPathInside(tempRoot, sdkRoot)) throw new Error('提取后的 SDK 目录不安全');
  assertSafeSymlinks(sdkRoot);
  assertArm64Elf(path.join(sdkRoot, 'libwemeetsdk.so'));
  assertArm64Elf(path.join(sdkRoot, 'libwemeet_base.so'));
  assertArm64Elf(addonPath);
  const upstreamBridgeSha256 = sha256File(bridgePath);
  fsImpl.mkdirSync(path.join(sdkRoot, 'prebuilt'), { recursive: true });
  fsImpl.renameSync(addonPath, path.join(sdkRoot, 'prebuilt', 'wemeet_electron_sdk.node'));
  sanitizeNativeBridge(bridgePath, fsImpl);
  writeManifest({ sdkRoot, bridgePath, sourcePackage, upstreamBridgeSha256, fsImpl });
  return { preparedSdk: sdkRoot, preparedBridge: bridgePath };
}

function isPlaceholderDirectory(directoryPath, fsImpl = fs) {
  return fsImpl.existsSync(directoryPath)
    && fsImpl.statSync(directoryPath).isDirectory()
    && fsImpl.readdirSync(directoryPath).every((name) => name === '.gitkeep');
}

function hasCompleteImport(sdkDestination, nativeDestination, fsImpl = fs) {
  return fsImpl.existsSync(nativeDestination)
    && requiredSdkPaths.every((relativePath) => fsImpl.existsSync(path.join(sdkDestination, relativePath)));
}

function assertImportTargetsAvailable(sdkDestination, nativeDestination, fsImpl = fs) {
  const hasSdk = fsImpl.existsSync(sdkDestination);
  const hasBridge = fsImpl.existsSync(nativeDestination);
  if (!hasSdk && !hasBridge) return;
  if (hasCompleteImport(sdkDestination, nativeDestination, fsImpl)) {
    throw new Error('检测到已完成的 SDK 导入；为保护本地资源，不会覆盖。请先运行 npm run sdk:verify。');
  }
  if (isPlaceholderDirectory(sdkDestination, fsImpl) && !hasBridge) return;
  throw new Error('检测到不完整的 SDK 导入残留；导入器不会自动删除未知文件。请核查 sdk/linux-arm64/3.26.100.14 和 native/wemeet.cpp 后再重试。');
}

function restorePlaceholder(directoryPath, fsImpl = fs) {
  fsImpl.mkdirSync(directoryPath, { recursive: true });
  fsImpl.writeFileSync(path.join(directoryPath, '.gitkeep'), '');
}

function commitPreparedImport({ preparedSdk, preparedBridge, sdkDestination, nativeDestination, fsImpl = fs, moveImpl = fs.renameSync }) {
  const sdkHadPlaceholder = isPlaceholderDirectory(sdkDestination, fsImpl);
  let createdSdk = false;
  let createdBridge = false;
  try {
    if (sdkHadPlaceholder) fsImpl.rmSync(sdkDestination, { recursive: true, force: true });
    fsImpl.mkdirSync(path.dirname(sdkDestination), { recursive: true });
    moveImpl(preparedSdk, sdkDestination);
    createdSdk = true;
    fsImpl.mkdirSync(path.dirname(nativeDestination), { recursive: true });
    moveImpl(preparedBridge, nativeDestination);
    createdBridge = true;
  } catch (error) {
    if (createdBridge) fsImpl.rmSync(nativeDestination, { force: true });
    if (createdSdk) fsImpl.rmSync(sdkDestination, { recursive: true, force: true });
    if (sdkHadPlaceholder && !fsImpl.existsSync(sdkDestination)) restorePlaceholder(sdkDestination, fsImpl);
    throw new Error(`SDK 导入提交失败，已清理本次半成品：${error.message}`);
  }
}

function printDiagnostics({ packagePath, archive, tarVersion }) {
  console.info(`tar 版本：${tarVersion}`);
  console.info(`归档成员总数：${archive.members.length}`);
  console.info(`安全选中成员数：${archive.plan.selectedMembers.length}`);
  console.info(`实际 tar 提取项数量：${archive.plan.extractMembers.length}`);
  console.info(`实际 tar 提取项列表：${archive.plan.extractMembers.join(', ')}`);
  if (archive.plan.usesFallbackMemberList) console.info('提示：归档未提供目录成员，已使用安全成员列表兼容提取。');
  console.info(`SDK 包：${path.basename(packagePath)}`);
}

function main({ packagePath = process.argv[2] || process.env.TMSDK_PACKAGE_PATH, fsImpl = fs, runTarImpl = runTar, spawnImpl = spawnSync } = {}) {
  if (!packagePath) throw new Error('请通过 TMSDK_PACKAGE_PATH 或第一个命令行参数提供 SDK 压缩包路径');
  if (path.basename(packagePath) !== expectedArchiveName) throw new Error(`SDK 包名不匹配，期望：${expectedArchiveName}`);
  if (!fsImpl.statSync(packagePath).isFile()) throw new Error('SDK 包路径不是普通文件');
  const sdkDestination = path.join(projectRoot, 'sdk', 'linux-arm64', SDK_VERSION);
  const nativeDestination = path.join(projectRoot, 'native', 'wemeet.cpp');
  assertImportTargetsAvailable(sdkDestination, nativeDestination, fsImpl);

  const archive = inspectArchive({ packagePath, runTarImpl });
  printDiagnostics({ packagePath, archive, tarVersion: getTarVersion(spawnImpl) });
  const tempRoot = fsImpl.mkdtempSync(path.join(projectRoot, '.sdk-import-tmp-'));
  try {
    extractArchive({ packagePath, tempRoot, plan: archive.plan, runTarImpl, fsImpl });
    const prepared = prepareImport({ tempRoot, root: expectedRoot, sourcePackage: path.basename(packagePath), fsImpl });
    commitPreparedImport({ ...prepared, sdkDestination, nativeDestination, fsImpl });
    console.info(`SDK ${SDK_VERSION} 已安全导入至 ${sdkDestination}`);
  } finally {
    fsImpl.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`SDK 导入失败：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { assertImportTargetsAvailable, commitPreparedImport, extractArchive, getTarVersion, inspectArchive, main, prepareImport, runTar };
