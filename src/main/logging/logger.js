'use strict';

const { redact } = require('../sdk/callback-parser');

function createLogger() {
  return {
    info(message, detail) {
      console.info(`[meeting-demo] ${message}`, detail === undefined ? '' : redact(detail));
    },
    error(message, detail) {
      console.error(`[meeting-demo] ${message}`, detail === undefined ? '' : redact(detail));
    }
  };
}

module.exports = { createLogger };
