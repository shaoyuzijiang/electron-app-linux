'use strict';

const { createCapabilities } = require('../../common/contracts/capabilities');

module.exports = createCapabilities({
  'meeting.join': true,
  'meeting.quick': true,
  'meeting.leave': true,
  'view.join': true,
  'view.schedule': true,
  'view.settings': true,
  'view.history': true,
  'view.detail': true,
  'view.screenCast': true,
  'view.voiceRecord': true,
  'view.record': true,
  'view.rooms': true,
  'settings.userConfiguration': true,
  'meeting.inviteUsers': true,
  'meeting.captions': true,
  'meeting.aiAssistant': true,
  'feature.im': true,
  'feature.calendar': true,
  'feature.contacts': true,
  'feature.webView': true,
  'feature.enterpriseSso': true,
});
