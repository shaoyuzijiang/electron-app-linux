'use strict';

const MAX_TEXT_LENGTH = 256;

function assertPlainObject(value, fieldName = '参数') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName}必须是对象`);
  }
}

function optionalText(value, fieldName, maxLength = MAX_TEXT_LENGTH) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new TypeError(`${fieldName}必须是不超过${maxLength}个字符的文本`);
  }
  return value.trim();
}

function validateInit(input) {
  assertPlainObject(input);
  return { appName: optionalText(input.appName, '应用名称', 80) || 'Linux Electron Demo' };
}

function validateLogin(input) {
  assertPlainObject(input);
  return { displayName: optionalText(input.displayName, '显示名称', 80) || 'Mock User' };
}

function validateJoinMeeting(input) {
  assertPlainObject(input);
  const meetingCode = optionalText(input.meetingCode, '会议号', 32);
  if (!/^[A-Za-z0-9-]{3,32}$/.test(meetingCode)) {
    throw new TypeError('会议号格式无效');
  }
  return { meetingCode };
}

module.exports = { validateInit, validateJoinMeeting, validateLogin };
