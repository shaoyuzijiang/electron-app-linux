'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SDK_VERSION = '3.26.100.14';
const SDK_ARCH = 'arm64';
const ELF_MACHINE_AARCH64 = 183;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function inspectElf(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(20);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead < header.length || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      return { isElf: false, isElf64: false, machine: null };
    }
    const isElf64 = header[4] === 2;
    const littleEndian = header[5] === 1;
    const machine = littleEndian ? header.readUInt16LE(18) : header.readUInt16BE(18);
    return { isElf: true, isElf64, machine };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertArm64Elf(filePath) {
  const info = inspectElf(filePath);
  if (!info.isElf || !info.isElf64) throw new Error(`${filePath} 不是 ELF64 文件`);
  if (info.machine !== ELF_MACHINE_AARCH64) throw new Error(`${filePath} 的 ELF e_machine=${info.machine}，期望 AArch64 (${ELF_MACHINE_AARCH64})`);
  return info;
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertSafeArchiveMember(memberPath, expectedRoot) {
  if (!memberPath || memberPath.includes('\0') || /[\r\n]/.test(memberPath) || path.posix.isAbsolute(memberPath) || memberPath.includes('\\')) {
    throw new Error(`压缩包成员路径不安全：${memberPath}`);
  }
  const parts = memberPath.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error(`压缩包成员存在路径穿越：${memberPath}`);
  if (parts[0] !== expectedRoot) throw new Error(`压缩包成员不属于预期 SDK 根目录：${memberPath}`);
}

function resolveArchiveLink(memberPath, linkTarget, expectedRoot) {
  if (!linkTarget || linkTarget.includes('\0') || /[\r\n]/.test(linkTarget) || path.posix.isAbsolute(linkTarget)) throw new Error(`符号链接目标不安全：${memberPath}`);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(memberPath), linkTarget));
  assertSafeArchiveMember(resolved, expectedRoot);
  return resolved;
}

function createSdkExtractionPlan(members, expectedRoot) {
  const uniqueMembers = new Set();
  for (const member of members) {
    assertSafeArchiveMember(member, expectedRoot);
    if (uniqueMembers.has(member)) throw new Error(`压缩包成员重复：${member}`);
    uniqueMembers.add(member);
  }

  const requiredFiles = [
    `${expectedRoot}/SDK/libwemeetsdk.so`,
    `${expectedRoot}/SDK/libwemeet_base.so`,
    `${expectedRoot}/SDK/saas_sdk_env.json`,
    `${expectedRoot}/Electron_Demo/wemeet_sdk/wemeet.cpp`,
    `${expectedRoot}/Electron_Demo/output/linux/wemeet_electron_sdk.node`
  ];
  const directoryRoots = [`${expectedRoot}/SDK/include`, `${expectedRoot}/SDK/Release`];
  for (const requiredFile of requiredFiles) {
    if (!uniqueMembers.has(requiredFile)) throw new Error(`SDK 压缩包缺少必需文件：${requiredFile}`);
  }

  const selectedMembers = members.filter((member) => requiredFiles.includes(member)
    || directoryRoots.some((directoryRoot) => member === directoryRoot || member === `${directoryRoot}/` || member.startsWith(`${directoryRoot}/`)));

  const directoryMembers = [];
  const fallbackMembers = [];
  for (const directoryRoot of directoryRoots) {
    const explicitDirectory = members.find((member) => member === directoryRoot || member === `${directoryRoot}/`);
    if (explicitDirectory) {
      directoryMembers.push(explicitDirectory);
      continue;
    }
    const descendants = members.filter((member) => member.startsWith(`${directoryRoot}/`));
    if (!descendants.length) throw new Error(`SDK 压缩包缺少必需目录或内容：${directoryRoot}`);
    fallbackMembers.push(...descendants);
  }

  const usesFallbackMemberList = fallbackMembers.length > 0;
  const extractMembers = usesFallbackMemberList
    ? [...requiredFiles, ...fallbackMembers]
    : [...requiredFiles, ...directoryMembers];
  if (new Set(extractMembers).size !== extractMembers.length) throw new Error('SDK 提取计划存在重复成员');
  if (!usesFallbackMemberList && directoryMembers.some((directory) => extractMembers.some((member) => member !== directory && member.startsWith(`${directory.replace(/\/$/, '')}/`)))) {
    throw new Error('SDK 提取计划不能同时包含目录和其子成员');
  }

  return Object.freeze({
    selectedMembers: Object.freeze([...selectedMembers]),
    extractMembers: Object.freeze(extractMembers),
    usesFallbackMemberList,
    requiredFiles: Object.freeze(requiredFiles),
    directoryMembers: Object.freeze(directoryMembers)
  });
}

function walkTree(rootPath, visitor) {
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    visitor(entryPath, entry);
    if (entry.isDirectory()) walkTree(entryPath, visitor);
  }
}

function assertSafeSymlinks(rootPath) {
  walkTree(rootPath, (entryPath, entry) => {
    if (!entry.isSymbolicLink()) return;
    const target = fs.readlinkSync(entryPath);
    if (path.isAbsolute(target)) throw new Error(`符号链接指向 SDK 目录外：${entryPath}`);
    const resolved = path.resolve(path.dirname(entryPath), target);
    if (!isPathInside(rootPath, resolved)) throw new Error(`符号链接逃逸 SDK 目录：${entryPath}`);
    if (!fs.existsSync(resolved)) throw new Error(`符号链接断裂：${entryPath}`);
  });
}

function collectExecutableElfFiles(rootPath) {
  const results = [];
  walkTree(rootPath, (entryPath, entry) => {
    if (!entry.isFile()) return;
    const mode = fs.statSync(entryPath).mode;
    if ((mode & 0o111) === 0 || !inspectElf(entryPath).isElf) return;
    results.push(path.relative(rootPath, entryPath));
  });
  return results.sort();
}

function copyPreservingLinks(source, destination) {
  fs.cpSync(source, destination, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, force: false, errorOnExist: true });
}

function validateManifestFiles(manifest, resolvePath) {
  const errors = [];
  if (!manifest || !Array.isArray(manifest.files)) return ['manifest files 字段无效'];
  for (const file of manifest.files) {
    const absolutePath = resolvePath(file.path);
    if (!fs.existsSync(absolutePath)) errors.push(`manifest 文件缺失：${file.path}`);
    else if (sha256File(absolutePath) !== file.sha256) errors.push(`manifest SHA-256 不匹配：${file.path}`);
  }
  return errors;
}

module.exports = {
  ELF_MACHINE_AARCH64,
  SDK_ARCH,
  SDK_VERSION,
  assertArm64Elf,
  assertSafeArchiveMember,
  assertSafeSymlinks,
  collectExecutableElfFiles,
  copyPreservingLinks,
  createSdkExtractionPlan,
  inspectElf,
  isPathInside,
  resolveArchiveLink,
  sha256File,
  validateManifestFiles
};
