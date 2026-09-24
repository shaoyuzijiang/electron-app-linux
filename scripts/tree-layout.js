'use strict';

const fs = require('fs');
const path = require('path');

const [rootInput, ...excludedInputs] = process.argv.slice(2);
if (!rootInput) throw new Error('用法: node scripts/tree-layout.js <root> [excluded-relative-prefix...]');
const root = path.resolve(rootInput);
const excluded = excludedInputs.map((item) => item.replace(/^\.\//, '').replace(/\/$/, ''));
const lines = [];

function isExcluded(relative) {
  return excluded.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}

function visit(relative) {
  const absolute = path.join(root, relative);
  for (const name of fs.readdirSync(absolute).sort()) {
    const child = relative ? path.posix.join(relative, name) : name;
    if (isExcluded(child)) continue;
    const stat = fs.lstatSync(path.join(root, child));
    const mode = (stat.mode & 0o7777).toString(8).padStart(4, '0');
    if (stat.isDirectory()) {
      lines.push(`d\t${mode}\t${child}`);
      visit(child);
    } else if (stat.isFile()) {
      lines.push(`f\t${mode}\t${child}`);
    } else if (stat.isSymbolicLink()) {
      lines.push(`l\t${mode}\t${child}\t${fs.readlinkSync(path.join(root, child))}`);
    } else {
      lines.push(`x\t${mode}\t${child}`);
    }
  }
}

visit('');
process.stdout.write(`${lines.sort().join('\n')}\n`);
