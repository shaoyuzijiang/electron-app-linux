'use strict';

const fs = require('fs');
const path = require('path');

const [output, ...inputs] = process.argv.slice(2);
if (!output || !inputs.length) {
  throw new Error('用法: node scripts/create-ar.js <output> <member...>');
}

function field(value, width) {
  const text = String(value);
  if (Buffer.byteLength(text) > width) throw new Error(`ar 字段过长: ${text}`);
  return text.padEnd(width, ' ');
}

const chunks = [Buffer.from('!<arch>\n', 'ascii')];
for (const input of inputs) {
  const name = path.basename(input);
  if (Buffer.byteLength(name) > 15) throw new Error(`ar 成员名过长: ${name}`);
  const data = fs.readFileSync(input);
  const header = field(`${name}/`, 16) + field(0, 12) + field(0, 6) + field(0, 6) +
    field('100644', 8) + field(data.length, 10) + '`\n';
  chunks.push(Buffer.from(header, 'ascii'), data);
  if (data.length % 2) chunks.push(Buffer.from('\n', 'ascii'));
}
fs.writeFileSync(output, Buffer.concat(chunks));
