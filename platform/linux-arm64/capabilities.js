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
  'view.screenCast': false,
  'view.voiceRecord': false,
  'view.record': false,
  'view.rooms': false,
  'settings.userConfiguration': false,
  'meeting.inviteUsers': false,
  'meeting.captions': false,
  'meeting.aiAssistant': false,
  'feature.im': true,
  'feature.calendar': true,
  'feature.contacts': true,
  'feature.webView': false,
  'feature.enterpriseSso': false,
});
