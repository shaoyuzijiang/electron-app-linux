'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { SdkLoader } = require('../src/main/sdk/sdk-loader');
const { parseCallback } = require('../src/main/sdk/callback-parser');

const timeoutMs = 30_000;

function waitForCallback(addon, eventName) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${eventName} 超时`)), timeoutMs);
    addon.AddJsCallback((payload) => {
      const result = parseCallback(payload);
      if (!result.ok) return;
      if (result.value.func !== eventName) return;
      clearTimeout(timer);
      resolve(result.value);
    });
  });
}

async function main() {
  await app.whenReady();
  const loader = new SdkLoader();
  const loaded = await loader.load({ isPackaged: false });
  console.info(`Addon 已加载，SDK 版本：${loaded.sdkVersion}`);
  console.info(`导出接口数量：${loaded.exports.length}`);

  const sdkId = process.env.TMSDK_ID;
  const sdkToken = process.env.TMSDK_TOKEN;
  if (!sdkId || !sdkToken) {
    console.info('未提供 TMSDK_ID/TMSDK_TOKEN；POC 已安全停在 addon 加载和版本查询。');
    return;
  }

  const dataPath = path.join(app.getPath('userData'), 'tmsdk-poc');
  fs.mkdirSync(dataPath, { recursive: true, mode: 0o700 });
  const initResult = waitForCallback(loaded.addon, 'OnSDKInitializeResult');
  const returnCode = loaded.addon.InitWemeetSDK(sdkId, sdkToken, dataPath, 'Linux ARM64 POC', '', 'zh-CN');
  if (returnCode !== 0) throw new Error(`InitWemeetSDK 调用返回错误码：${returnCode}`);
  const initCallback = await initResult;
  if (Number(initCallback.code) !== 0) throw new Error(`OnSDKInitializeResult 返回错误码：${initCallback.code}`);
  console.info('初始化回调成功；开始反初始化。');

  const uninitResult = waitForCallback(loaded.addon, 'OnSDKUninitializeResult');
  loaded.addon.UninitWemeetSDK('{"force":true}');
  const uninitCallback = await uninitResult;
  if (Number(uninitCallback.code) !== 0) throw new Error(`OnSDKUninitializeResult 返回错误码：${uninitCallback.code}`);
  console.info('反初始化回调成功。');
}

main().catch((error) => {
  console.error(`Linux ARM64 POC 失败：${error.message}`);
  process.exitCode = 1;
}).finally(() => app.quit());
