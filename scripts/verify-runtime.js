'use strict';

const path = require('node:path');
const { assertArm64Elf, assertSafeSymlinks } = require('./sdk-utils');
const { assertRuntimeLayout, getRuntimeRoot } = require('../src/main/sdk/linux-runtime');

try {
  const runtimeRoot = assertRuntimeLayout(getRuntimeRoot({ projectRoot: path.resolve(__dirname, '..') }));
  for (const filename of ['wemeet_electron_sdk.node', 'libwemeetsdk.so', 'libwemeet_base.so']) assertArm64Elf(path.join(runtimeRoot, filename));
  assertSafeSymlinks(runtimeRoot);
  console.info(`SDK 运行时校验通过：${runtimeRoot}`);
} catch (error) {
  console.error(`SDK 运行时校验失败：${error.message}`);
  process.exitCode = 1;
}
