'use strict';

const { EventEmitter } = require('node:events');
const { parseCallback } = require('./callback-parser');
const { publicCapabilities } = require('./sdk-capabilities');
const { getRuntimeDiagnostics } = require('./linux-runtime');
const { SdkLoader } = require('./sdk-loader');
const { SDK_STATES, SdkStateMachine } = require('./sdk-state');

class SdkService extends EventEmitter {
  constructor({ mockEnabled, logger, isPackaged = false, loader = new SdkLoader() }) {
    super();
    this.mockEnabled = mockEnabled;
    this.logger = logger;
    this.isPackaged = isPackaged;
    this.loader = loader;
    this.stateMachine = new SdkStateMachine();
    this.callbacks = [];
    this.inMeeting = false;
    this.activeOperation = null;
    this.sdk = null;
    this.runtime = null;
    this.runtimeExports = [];
  }

  async prepare() {
    if ([SDK_STATES.UNLOADED, SDK_STATES.RELEASED].includes(this.stateMachine.state)) this.transition(SDK_STATES.RUNTIME_READY);
    try {
      if (this.mockEnabled) {
        const { MockSdk } = require('./mock-sdk');
        this.sdk = new MockSdk();
        this.runtimeExports = MockSdk.exportedMethods;
        this.sdk.on('callback', (payload) => this.recordCallback(payload));
      } else {
        const loaded = await this.loader.load({ isPackaged: this.isPackaged });
        this.sdk = loaded.addon;
        this.runtime = loaded.runtime;
        this.runtimeExports = loaded.exports;
      }
      this.transition(SDK_STATES.LOADED);
    } catch (error) {
      error.fatal = true;
      this.fail(error);
      throw error;
    }
  }

  getSnapshot() {
    return {
      state: this.stateMachine.state,
      mockEnabled: this.mockEnabled,
      inMeeting: this.inMeeting,
      diagnostics: getRuntimeDiagnostics({ mockEnabled: this.mockEnabled, sdkState: this.stateMachine.state, runtime: this.runtime }),
      capabilities: publicCapabilities(this.runtimeExports),
      callbacks: [...this.callbacks]
    };
  }

  async initialize(input) {
    return this.runExclusive('initialize', async () => {
      this.requireMockState(SDK_STATES.LOADED, '初始化');
      this.transition(SDK_STATES.INITIALIZING);
      await this.sdk.initialize(input);
      this.transition(SDK_STATES.INITIALIZED);
      return this.getSnapshot();
    });
  }

  async login(input) {
    return this.runExclusive('login', async () => {
      this.requireMockState(SDK_STATES.INITIALIZED, '登录');
      this.transition(SDK_STATES.LOGGING_IN);
      await this.sdk.login(input);
      this.transition(SDK_STATES.LOGGED_IN);
      return this.getSnapshot();
    });
  }

  async joinMeeting(input) {
    return this.runExclusive('join-meeting', async () => {
      this.requireMockState(SDK_STATES.LOGGED_IN, '入会');
      if (this.inMeeting) throw new Error('当前已在会议中');
      await this.sdk.joinMeeting(input);
      this.inMeeting = true;
      this.emitUpdate();
      return this.getSnapshot();
    });
  }

  async leaveMeeting() {
    return this.runExclusive('leave-meeting', async () => {
      await this.leaveMeetingInternal();
      return this.getSnapshot();
    });
  }

  async logout() {
    return this.runExclusive('logout', async () => {
      await this.logoutInternal();
      return this.getSnapshot();
    });
  }

  async uninitialize() {
    return this.runExclusive('uninitialize', async () => {
      this.requireMockState([SDK_STATES.INITIALIZED, SDK_STATES.LOGGED_IN], '反初始化');
      if (this.inMeeting) await this.leaveMeetingInternal();
      if (this.stateMachine.state === SDK_STATES.LOGGED_IN) await this.logoutInternal();
      this.transition(SDK_STATES.UNINITIALIZING);
      await this.sdk.uninitialize();
      this.transition(SDK_STATES.RELEASED);
      return this.getSnapshot();
    });
  }

  async leaveMeetingInternal() {
    this.requireMockState(SDK_STATES.LOGGED_IN, '离会');
    if (!this.inMeeting) throw new Error('当前不在会议中');
    await this.sdk.leaveMeeting();
    this.inMeeting = false;
    this.emitUpdate();
  }

  async logoutInternal() {
    this.requireMockState(SDK_STATES.LOGGED_IN, '登出');
    if (this.inMeeting) await this.leaveMeetingInternal();
    this.transition(SDK_STATES.LOGGING_OUT);
    await this.sdk.logout();
    this.transition(SDK_STATES.INITIALIZED);
  }

  async dispose() {
    if (!this.mockEnabled || ![SDK_STATES.INITIALIZED, SDK_STATES.LOGGED_IN].includes(this.stateMachine.state)) return;
    try {
      await this.uninitialize();
    } catch (error) {
      this.logger.error('退出时反初始化失败', error);
    }
  }

  async runExclusive(name, operation) {
    if (this.activeOperation) throw new Error(`操作进行中：${this.activeOperation}`);
    this.activeOperation = name;
    try {
      return await operation();
    } catch (error) {
      if (error.fatal) this.fail(error);
      throw error;
    } finally {
      this.activeOperation = null;
      this.emitUpdate();
    }
  }

  requireMockState(expectedState, action) {
    if (!this.mockEnabled || !this.sdk) throw new Error(`真实 SDK 业务调用尚未接入；${action}仅可在 Mock 模式验证。`);
    const accepted = Array.isArray(expectedState) ? expectedState : [expectedState];
    if (!accepted.includes(this.stateMachine.state)) throw new Error(`${action}要求 SDK 状态为 ${accepted.join(' 或 ')}，当前为 ${this.stateMachine.state}`);
  }

  recordCallback(payload) {
    const result = parseCallback(payload);
    const entry = result.ok
      ? { time: new Date().toISOString(), ...result.value }
      : { time: new Date().toISOString(), event: 'CallbackParseError', error: result.error };
    this.callbacks = [entry, ...this.callbacks].slice(0, 100);
    this.emitUpdate();
  }

  transition(nextState) {
    this.stateMachine.transition(nextState);
    this.emitUpdate();
  }

  fail(error) {
    this.logger.error('SDK 操作失败', error);
    if (this.stateMachine.state !== SDK_STATES.ERROR && this.stateMachine.canTransition(SDK_STATES.ERROR)) this.stateMachine.transition(SDK_STATES.ERROR);
    this.recordCallback({ event: 'Error', message: error.message });
  }

  emitUpdate() {
    this.emit('update', this.getSnapshot());
  }
}

module.exports = { SdkService };
