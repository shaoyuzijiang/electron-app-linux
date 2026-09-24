'use strict';

const fs = require('fs');

const output = process.argv[2];
if (!output) throw new Error('缺少 addon provenance 输出路径');
const env = process.env;
const provenance = {
  electronVersion: env.ELECTRON_VERSION,
  sdkVersion: '3.26.100.14',
  sdkArchiveSha256: env.SDK_ARCHIVE_SHA,
  sdkSourceTreeSha256: env.SDK_SOURCE_TREE_SHA,
  headersArchiveSha256: env.HEADERS_ARCHIVE_SHA,
  headersTreeSha256: env.HEADERS_TREE_SHA,
  addonSha256: env.ADDON_SHA,
  buildInputTreeSha256: env.BUILD_INPUT_SHA,
  nodeVersion: env.NODE_VERSION,
  npmVersion: env.NPM_VERSION,
  pythonVersion: env.PYTHON_VERSION,
  nodeGypVersion: env.NODE_GYP_VERSION,
  nodeGypTreeSha256: env.NODE_GYP_TREE_SHA,
  packageLockSha256: env.PACKAGE_LOCK_SHA,
  nodeBinarySha256: env.NODE_BINARY_SHA,
  npmExecutableSha256: env.NPM_EXECUTABLE_SHA,
  compiler: env.COMPILER,
  compilerSha256: env.COMPILER_SHA,
  linkerSha256: env.LINKER_SHA,
  assemblerSha256: env.ASSEMBLER_SHA,
  systemToolchainTreeSha256: env.SYSTEM_TOOLCHAIN_TREE_SHA,
  buildFlags: {
    cflags: env.CFLAGS || '',
    cxxflags: env.CXXFLAGS || '',
    cppflags: env.CPPFLAGS || '',
    ldflags: env.LDFLAGS || '',
  },
  glibc: env.GLIBC_VERSION,
  osReleaseSha256: env.OS_RELEASE_SHA,
  osPrettyName: env.OS_PRETTY_NAME,
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(output, `${JSON.stringify(provenance, null, 2)}\n`);
