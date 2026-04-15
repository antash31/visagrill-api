'use strict';

const { Router } = require('express');
const express = require('express');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const controller = require('./interview.controller');

const router = Router();

router.post('/init', express.json(), authMiddleware, controller.init);
router.get('/history', authMiddleware, controller.history);

module.exports = router;
