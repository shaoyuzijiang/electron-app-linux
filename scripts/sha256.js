'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(root, relative, result) {
  const absolute = path.join(root, relative);
  for (const name of fs.readdirSync(absolute).sort()) {
    const child = path.join(relative, name);
    const stat = fs.lstatSync(path.join(root, child));
    if (stat.isDirectory()) walk(root, child, result);
    else if (stat.isFile()) result.push(child.split(path.sep).join('/'));
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'sum') {
  if (args.length !== 1) throw new Error('用法: sha256.js sum <file>');
  console.log(`${digest(args[0])}  ${path.basename(args[0])}`);
} else if (command === 'check') {
  const [checksumFile, baseDir = path.dirname(checksumFile || '')] = args;
  if (!checksumFile) throw new Error('用法: sha256.js check <checksum-file> [base-dir]');
  const lines = fs.readFileSync(checksumFile, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match) throw new Error(`无效 SHA-256 行: ${line}`);
    const relative = match[2];
    const target = path.resolve(baseDir, relative);
    const root = path.resolve(baseDir);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`校验路径越界: ${relative}`);
    if (digest(target) !== match[1]) throw new Error(`SHA-256 不匹配: ${relative}`);
    console.log(`${relative}: OK`);
  }
} else if (command === 'manifest') {
  const [rootInput, ...excluded] = args;
  if (!rootInput) throw new Error('用法: sha256.js manifest <root> [excluded-relative...]');
  const root = path.resolve(rootInput);
  const excludedSet = new Set(excluded.map((item) => item.replace(/^\.\//, '')));
  const files = [];
  walk(root, '', files);
  for (const relative of files) {
    if (excludedSet.has(relative)) continue;
    console.log(`${digest(path.join(root, relative))}  ./${relative}`);
  }
} else {
  throw new Error('命令必须是 sum、check 或 manifest');
}
