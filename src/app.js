'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env.config');
const paymentRoutes = require('./modules/payments/payment.routes');
const interviewRoutes = require('./modules/interviews/interview.routes');
const userRoutes = require('./modules/users/user.routes');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler.middleware');

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN === '*' ? true : env.FRONTEND_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  }),
);
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// IMPORTANT: the Razorpay webhook must receive the RAW body so HMAC-SHA256
// verification works. We mount it BEFORE any global express.json() and the
// route itself uses express.raw(). This is why we DO NOT apply express.json()
// globally here — each JSON route opts in via its own router.
app.use('/api/payments', paymentRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/users', userRoutes);

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
