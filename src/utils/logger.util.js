'use strict';

const fmt = () => new Date().toISOString();

const logger = {
  info: (...args) => console.log(`[${fmt()}] [INFO]`, ...args),
  warn: (...args) => console.warn(`[${fmt()}] [WARN]`, ...args),
  error: (...args) => console.error(`[${fmt()}] [ERROR]`, ...args),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') console.log(`[${fmt()}] [DEBUG]`, ...args);
  },
};

module.exports = logger;
