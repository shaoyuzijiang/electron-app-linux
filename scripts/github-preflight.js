'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const maxFileSize = 50 * 1024 * 1024;
const blockedExtensions = new Set(['.so', '.node', '.tar', '.gz', '.tgz', '.appimage']);
const blockedExactNames = new Set(['wemeet.cpp', 'sdk-manifest.json', 'saas_sdk_env.json', 'libwemeetsdk.so', 'libwemeet_base.so']);
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /TMSDK_TOKEN\s*=\s*['"](?!\.{3}|<|\[|\$\{)[^'"]{8,}/,
  /(?:https?:\/\/)[^\s'"`]+(?:sso|id_token|sdk_token|access_token)=[^\s'"`]+/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/
];

function gitFiles() {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: projectRoot, encoding: 'utf8' });
  return output.split('\0').filter(Boolean);
}

function walkForEnvFiles(directory, results = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'sdk', 'output', 'build', 'dist', 'release'].includes(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkForEnvFiles(entryPath, results);
    else if (entry.isFile() && (entry.name === '.env' || entry.name.startsWith('.env.'))) results.push(path.relative(projectRoot, entryPath));
  }
  return results;
}

function isBlockedSdkPath(relativePath) {
  return relativePath === 'native/wemeet.cpp'
    || relativePath.startsWith('sdk/linux-arm64/') && (relativePath.includes('/include/') || relativePath.includes('/Release/') || relativePath.includes('/prebuilt/') || blockedExactNames.has(path.basename(relativePath)));
}

function scan() {
  const failures = [];
  const files = gitFiles();
  for (const relativePath of files) {
    const absolutePath = path.join(projectRoot, relativePath);
    const lowerName = path.basename(relativePath).toLowerCase();
    const extension = path.extname(lowerName);
    if (blockedExtensions.has(extension) || isBlockedSdkPath(relativePath)) failures.push(`${relativePath}: 禁止提交 SDK/原生二进制或归档文件`);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
    const size = fs.statSync(absolutePath).size;
    if (size > maxFileSize) failures.push(`${relativePath}: 待提交文件超过 50MB`);
    if (size > 2 * 1024 * 1024) continue;
    const content = fs.readFileSync(absolutePath, 'utf8');
    if (/\/Users\/[^/\s]+\//.test(content) || /\/home\/[^/\s]+\//.test(content)) failures.push(`${relativePath}: 包含本机私有路径`);
    if (credentialPatterns.some((pattern) => pattern.test(content))) failures.push(`${relativePath}: 疑似凭证字段或私钥`);
  }
  for (const relativePath of walkForEnvFiles(projectRoot)) failures.push(`${relativePath}: 存在本地环境文件`);
  return failures;
}

try {
  const failures = scan();
  if (failures.length) {
    console.error('GitHub 提交前检查失败：');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.info('GitHub 提交前检查通过：未发现待提交 SDK 二进制、疑似凭证、本机路径或超过 50MB 的文件。');
  }
} catch (error) {
  console.error(`GitHub 提交前检查无法完成：${error.message}`);
  process.exitCode = 1;
}
