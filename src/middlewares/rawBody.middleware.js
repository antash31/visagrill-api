'use strict';

const express = require('express');

/**
 * Razorpay webhook signature is computed over the EXACT raw request body.
 * express.json() would mutate/reserialize the payload and break HMAC verification,
 * so this route uses express.raw to preserve bytes as a Buffer on req.body.
 */
const rawJsonBody = express.raw({ type: 'application/json', limit: '1mb' });

module.exports = { rawJsonBody };
