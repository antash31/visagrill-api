'use strict';

const { Router } = require('express');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const controller = require('./user.controller');

const router = Router();

router.get('/me', authMiddleware, controller.me);

module.exports = router;
