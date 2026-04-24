'use strict';

const express = require('express');
const { Router } = require('express');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const controller = require('./user.controller');

const router = Router();

router.get('/me', authMiddleware, controller.me);
// Global express.json() is intentionally NOT applied (see app.js — Razorpay
// webhook needs raw body), so opt in per-route. #genai
router.patch('/me', express.json(), authMiddleware, controller.updateMe);

module.exports = router;
