'use strict';

const { Router } = require('express');
const express = require('express');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { rawJsonBody } = require('../../middlewares/rawBody.middleware');
const controller = require('./payment.controller');

const router = Router();

// NOTE: webhook is mounted on the parent router BEFORE express.json() is applied
// to this sub-router, and it uses rawJsonBody so the HMAC check can run on exact bytes.
router.post('/webhook', rawJsonBody, controller.webhook);

// JSON routes for authenticated clients
router.post('/create-order', express.json(), authMiddleware, controller.createOrder);
router.post('/verify', express.json(), authMiddleware, controller.verify);

module.exports = router;
