'use strict';

const ACTIONS = Object.freeze([
  'meeting.join',
  'meeting.quick',
  'meeting.leave',
  'view.join',
  'view.schedule',
  'view.settings',
  'view.history',
  'view.detail',
  'view.screenCast',
  'view.voiceRecord',
  'view.record',
  'view.rooms',
  'settings.userConfiguration',
  'meeting.inviteUsers',
  'meeting.captions',
  'meeting.aiAssistant',
  'feature.im',
  'feature.calendar',
  'feature.contacts',
  'feature.webView',
  'feature.enterpriseSso',
]);

function createCapabilities(values = {}) {
  const capabilities = {};
  for (const action of ACTIONS) capabilities[action] = values[action] === true;
  return Object.freeze(capabilities);
}

function supports(capabilities, action) {
  return Boolean(capabilities && capabilities[action] === true);
}

function unsupportedMessage(action) {
  return `当前平台 SDK 不支持 ${action}`;
}

module.exports = { ACTIONS, createCapabilities, supports, unsupportedMessage };
