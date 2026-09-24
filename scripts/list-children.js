'use strict';

const fs = require('fs');
const path = require('path');

const directory = process.argv[2];
if (!directory) throw new Error('用法: node scripts/list-children.js <directory>');
for (const name of fs.readdirSync(path.resolve(directory)).sort()) console.log(name);
