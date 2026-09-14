'use strict';

const { EventEmitter } = require('node:events');

class MockSdk extends EventEmitter {
  static exportedMethods = Object.freeze(['InitWemeetSDK', 'Login', 'Logout', 'UninitWemeetSDK', 'JoinMeeting', 'LeaveMeeting']);

  constructor() {
    super();
    this.inMeeting = false;
  }

  async initialize({ appName }) {
    await delay();
    this.emit('callback', JSON.stringify({ event: 'OnSDKInitializeResult', code: 0, message: `${appName} 初始化成功（Mock）` }));
  }

  async login({ displayName }) {
    await delay();
    this.emit('callback', JSON.stringify({ event: 'OnLogin', code: 0, user: displayName, message: 'Mock 登录成功' }));
  }

  async joinMeeting({ meetingCode }) {
    await delay();
    this.inMeeting = true;
    this.emit('callback', JSON.stringify({ event: 'OnMeetingJoined', code: 0, meetingCode, message: 'Mock 已入会' }));
  }

  async leaveMeeting() {
    await delay();
    this.inMeeting = false;
    this.emit('callback', JSON.stringify({ event: 'OnMeetingLeft', code: 0, message: 'Mock 已离会' }));
  }

  async logout() {
    await delay();
    this.emit('callback', JSON.stringify({ event: 'OnLogout', code: 0, message: 'Mock 已登出' }));
  }

  async uninitialize() {
    await delay();
    this.emit('callback', JSON.stringify({ event: 'OnSDKUninitializeResult', code: 0, message: 'Mock 反初始化成功' }));
  }
}

function delay() {
  return new Promise((resolve) => setTimeout(resolve, 180));
}

module.exports = { MockSdk };
