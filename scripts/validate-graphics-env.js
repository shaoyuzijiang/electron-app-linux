'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { configureGraphicsEnvironment, parseNullEnvironment } = require('../platform/linux-arm64/graphics-env');

function run() {
  const env = {
    XDG_SESSION_TYPE: 'wayland',
    WAYLAND_DISPLAY: 'wayland-0',
    LD_PRELOAD: '/tmp/untrusted.so',
    PATH: '/usr/bin',
  };
  const patch = configureGraphicsEnvironment({
    env,
    sdkRoot: '/opt/demo/sdk',
    patchPath: '/opt/x11-wayland/x11-ext.sh',
    existsSync: (file) => file === '/opt/x11-wayland/x11-ext.sh',
    run: (_command, args) => {
      assert.strictEqual(args[3], '/opt/x11-wayland/x11-ext.sh');
      return {
        status: 0,
        stdout: Buffer.from('LD_LIBRARY_PATH=/usr/lib/aarch64-linux-gnu/\0MESA_LOADER_DRIVER_OVERRIDE=zink\0LP_NUM_THREADS=2\0'),
      };
    },
  });
  assert.strictEqual(patch.applied, true);
  // 官方顺序：SDK 私有路径最前，其次补丁生成的 Mesa 系统路径。
  assert.strictEqual(env.LD_LIBRARY_PATH, '/opt/demo/sdk:/opt/demo/sdk/Release/lib:/usr/lib/aarch64-linux-gnu/');
  assert.strictEqual(env.MESA_LOADER_DRIVER_OVERRIDE, 'zink');
  assert.strictEqual(env.LP_NUM_THREADS, '2');
  assert.strictEqual(env.LD_PRELOAD, '');
  assert.strictEqual(env.QT_QPA_PLATFORM, 'xcb');
  assert.strictEqual(env.EGL_PLATFORM, 'x11');
  assert.strictEqual(env.XDG_SESSION_TYPE, 'x11');
  assert.strictEqual(env.WAYLAND_DISPLAY, undefined);
  assert.strictEqual(env.WEMEET_XWAYLAND, undefined);
  assert.strictEqual(env.LIBGL_ALWAYS_SOFTWARE, undefined);
  assert.strictEqual(env.LIBGL_ALWAYS_INDIRECT, undefined);

  const missingEnv = { XDG_SESSION_TYPE: 'wayland', PATH: '/usr/bin' };
  const missing = configureGraphicsEnvironment({ env: missingEnv, sdkRoot: '/tmp/sdk', existsSync: () => false });
  assert.deepStrictEqual(missing, { applied: false, reason: 'missing', patchPath: '/opt/x11-wayland/x11-ext.sh' });
  assert.strictEqual(missingEnv.LD_LIBRARY_PATH, '/tmp/sdk:/tmp/sdk/Release/lib');
  assert.strictEqual(parseNullEnvironment(Buffer.from('IGNORED=value\0LD_LIBRARY_PATH=/mesa\0')).LD_LIBRARY_PATH, '/mesa');

  const root = path.resolve(__dirname, '..');
  const sourceLauncher = fs.readFileSync(path.join(root, 'scripts', 'start-linux.sh'), 'utf8');
  const packageLauncher = fs.readFileSync(path.join(root, 'packaging', 'launcher.sh'), 'utf8');
  const linuxMain = fs.readFileSync(path.join(root, 'platform', 'linux-arm64', 'main.js'), 'utf8');
  const debBuilder = fs.readFileSync(path.join(root, 'scripts', 'build-deb.sh'), 'utf8');
  assert(sourceLauncher.includes('/opt/x11-wayland/x11-ext.sh') || fs.readFileSync(path.join(root, 'packaging', 'graphics-env.sh'), 'utf8').includes('/opt/x11-wayland/x11-ext.sh'), '源码启动链路必须加载麒麟 XWayland 补丁');
  assert(packageLauncher.includes('/opt/x11-wayland/x11-ext.sh') || fs.readFileSync(path.join(root, 'packaging', 'graphics-env.sh'), 'utf8').includes('/opt/x11-wayland/x11-ext.sh'), '安装版启动链路必须加载麒麟 XWayland 补丁');
  assert(sourceLauncher.includes('LD_PRELOAD=') || fs.readFileSync(path.join(root, 'packaging', 'graphics-env.sh'), 'utf8').includes('LD_PRELOAD='), '源码启动链路必须清空 LD_PRELOAD');
  assert(sourceLauncher.includes('wemeet_prepare_x11_wayland "$OUT"'), '源码启动器必须应用 Mesa 补丁环境');
  assert(packageLauncher.includes('wemeet_prepare_x11_wayland "$SDK_ROOT"'), '安装版启动器必须应用 Mesa 补丁环境');
  assert(linuxMain.includes('configureGraphicsEnvironment'), 'Linux 主进程必须在加载 Electron 前配置 Mesa 环境');
  assert(/appendSwitch\('ozone-platform', 'x11'\)[\s\S]*?appendSwitch\('disable-gpu'\)/.test(linuxMain), 'X11 与禁用 GPU 开关必须在主进程早期按序注册');
  assert(linuxMain.includes("appendSwitch('disable-gpu')"), 'Linux 主进程必须禁用 GPU 走软件渲染，防止麒麟 GPU 进程初始化失败');
  assert(debBuilder.includes('graphics-env.sh'), 'DEB 必须携带图形环境脚本');
  console.log('麒麟 X11-Wayland Mesa 图形环境校验通过。');
}

try { run(); } catch (error) { console.error(error); process.exitCode = 1; }
