'use strict';

const http = require('http');
const { Server } = require('socket.io');

const env = require('./config/env.config');
const app = require('./app');
const { registerInterviewNamespace } = require('./modules/interviews/interview.socket');
const logger = require('./utils/logger.util');

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_ORIGIN === '*' ? true : env.FRONTEND_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  },
  maxHttpBufferSize: 1e7, // 10 MB for audio chunks
});

// Dedicated namespace for the live interview stream.
const interviewsNs = io.of('/interviews');
registerInterviewNamespace(interviewsNs);

server.listen(env.PORT, () => {
  logger.info(`VisaGrill API listening on :${env.PORT} (env=${env.NODE_ENV})`);
});

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down...`);
  io.close(() => {
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => logger.error('unhandledRejection:', err));
process.on('uncaughtException', (err) => logger.error('uncaughtException:', err));
