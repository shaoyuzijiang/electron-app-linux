'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [rootInput, ...entries] = process.argv.slice(2);
if (!rootInput || !entries.length) {
  throw new Error('用法: node scripts/hash-tree.js <root> <relative-path...>');
}
const root = path.resolve(rootInput);
const records = [];

function visit(relative) {
  const normalized = relative.split(path.sep).join('/').replace(/^\.\//, '');
  const absolute = path.resolve(root, normalized);
  const rootPrefix = root === path.parse(root).root ? root : `${root}${path.sep}`;
  if (absolute !== root && !absolute.startsWith(rootPrefix)) throw new Error(`路径越界: ${relative}`);
  const stat = fs.lstatSync(absolute);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(absolute).sort()) visit(path.posix.join(normalized, child));
  } else if (stat.isSymbolicLink()) {
    records.push({ relative: normalized, type: 'link', content: Buffer.from(fs.readlinkSync(absolute)) });
  } else if (stat.isFile()) {
    records.push({ relative: normalized, type: 'file', content: fs.readFileSync(absolute) });
  } else {
    throw new Error(`不支持的文件类型: ${relative}`);
  }
}

for (const entry of entries) visit(entry);
records.sort((a, b) => a.relative.localeCompare(b.relative, 'en'));
const hash = crypto.createHash('sha256');
for (const record of records) {
  hash.update(record.type);
  hash.update('\0');
  hash.update(record.relative);
  hash.update('\0');
  hash.update(record.content);
  hash.update('\0');
}
process.stdout.write(`${hash.digest('hex')}\n`);
