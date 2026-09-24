'use strict';

const fs = require('fs');

const [archive, requested] = process.argv.slice(2);
if (!archive || !requested) throw new Error('用法: node scripts/extract-ar.js <archive> <member>');
const source = fs.readFileSync(archive);
if (source.subarray(0, 8).toString('ascii') !== '!<arch>\n') throw new Error('不是有效的 ar 归档');
let offset = 8;
let found = false;
while (offset + 60 <= source.length) {
  const header = source.subarray(offset, offset + 60);
  if (header.subarray(58, 60).toString('ascii') !== '`\n') throw new Error('ar 成员头损坏');
  const name = header.subarray(0, 16).toString('ascii').trim().replace(/\/$/, '');
  const size = Number.parseInt(header.subarray(48, 58).toString('ascii').trim(), 10);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('ar 成员长度无效');
  const start = offset + 60;
  const end = start + size;
  if (end > source.length) throw new Error('ar 成员越界');
  if (name === requested) {
    fs.writeFileSync(1, source.subarray(start, end));
    found = true;
    break;
  }
  offset = end + (size % 2);
}
if (!found) throw new Error(`ar 归档缺少成员: ${requested}`);
