'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SDK_VERSION, prepareLinuxRuntime } = require('./linux-runtime');

class SdkLoader {
  constructor({ runtimePreparer = prepareLinuxRuntime, requireImpl = require } = {}) {
    this.runtimePreparer = runtimePreparer;
    this.requireImpl = requireImpl;
  }

  async load(options = {}) {
    const runtime = await this.runtimePreparer(options);
    const addonPath = path.join(runtime.runtimeRoot, 'wemeet_electron_sdk.node');
    if (!fs.existsSync(addonPath)) throw new Error(`未找到 SDK addon：${addonPath}`);
    let addon;
    try {
      addon = this.requireImpl(addonPath);
    } catch (error) {
      throw new Error(`加载 Linux ARM64 SDK addon 失败：${error.message}`);
    }
    if (!addon || typeof addon.GetSDKVersion !== 'function') throw new Error('SDK addon 缺少 GetSDKVersion()');
    let sdkVersion;
    try {
      sdkVersion = String(addon.GetSDKVersion() || '');
    } catch (error) {
      throw new Error(`读取 SDK 版本失败：${error.message}`);
    }
    if (!sdkVersion.includes(SDK_VERSION)) throw new Error(`SDK 版本不匹配：期望包含 ${SDK_VERSION}，实际为 ${sdkVersion || '空'}`);
    return { addon, exports: Object.keys(addon).sort(), sdkVersion, runtimeRoot: runtime.runtimeRoot, runtime: { ...runtime, loaded: true } };
  }
}

module.exports = { SdkLoader };
