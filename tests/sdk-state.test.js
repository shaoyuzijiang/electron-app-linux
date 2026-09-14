'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SDK_STATES, SdkStateMachine } = require('../src/main/sdk/sdk-state');

test('SDK 状态机允许正常生命周期转换', () => {
  const machine = new SdkStateMachine();
  const sequence = [
    SDK_STATES.RUNTIME_READY,
    SDK_STATES.LOADED,
    SDK_STATES.INITIALIZING,
    SDK_STATES.INITIALIZED,
    SDK_STATES.LOGGING_IN,
    SDK_STATES.LOGGED_IN,
    SDK_STATES.LOGGING_OUT,
    SDK_STATES.INITIALIZED,
    SDK_STATES.UNINITIALIZING,
    SDK_STATES.RELEASED
  ];
  for (const nextState of sequence) machine.transition(nextState);
  assert.equal(machine.state, SDK_STATES.RELEASED);
});

test('SDK 状态机拒绝非法状态转换', () => {
  const machine = new SdkStateMachine();
  assert.throws(() => machine.transition(SDK_STATES.LOGGED_IN), /非法 SDK 状态转换/);
});

test('SDK 状态机允许从错误状态恢复或释放', () => {
  const machine = new SdkStateMachine();
  machine.transition(SDK_STATES.ERROR);
  machine.transition(SDK_STATES.UNLOADED);
  assert.equal(machine.state, SDK_STATES.UNLOADED);
});
