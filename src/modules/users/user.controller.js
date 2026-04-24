'use strict';

const userService = require('./user.service');

async function me(req, res, next) {
  try {
    const profile = await userService.getProfile(req.user.id);
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

// #genai
async function updateMe(req, res, next) {
  try {
    const profile = await userService.updateProfile(req.user.id, req.body || {});
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

module.exports = { me, updateMe };
