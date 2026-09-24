'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const command = process.platform === 'linux'
  ? { executable: 'bash', args: [path.join(__dirname, '..', 'scripts', 'start-linux.sh')] }
  : { executable: process.platform === 'win32' ? 'cmd.exe' : 'sh', args: process.platform === 'win32'
    ? ['/d', '/s', '/c', 'node bootstrap/start.js && electron .']
    : ['-c', 'node bootstrap/start.js && electron .'] };

const result = spawnSync(command.executable, command.args, { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env });
if (result.error) throw result.error;
process.exitCode = Number.isInteger(result.status) ? result.status : 1;
