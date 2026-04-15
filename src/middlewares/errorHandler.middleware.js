'use strict';

const logger = require('../utils/logger.util');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  logger.error(`${req.method} ${req.originalUrl} -> ${status}:`, err.message);
  if (status >= 500) logger.error(err.stack);

  res.status(status).json({
    error: err.publicMessage || (status >= 500 ? 'Internal server error' : err.message),
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFoundHandler };
