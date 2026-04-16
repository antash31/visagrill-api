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

module.exports = { me };
