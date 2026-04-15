'use strict';

const Razorpay = require('razorpay');
const env = require('./env.config');

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

module.exports = razorpay;
