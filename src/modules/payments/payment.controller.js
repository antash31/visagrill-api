'use strict';

const paymentService = require('./payment.service');
const logger = require('../../utils/logger.util');

async function createOrder(req, res, next) {
  try {
    const { plan_id } = req.body || {};
    if (!plan_id) return res.status(400).json({ error: 'plan_id is required' });

    const { order, plan } = await paymentService.createOrder({
      userId: req.user.id,
      planId: plan_id,
    });

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      plan: { id: plan_id, tier: plan.tier, credits: plan.credits },
    });
  } catch (err) {
    next(err);
  }
}

async function verify(req, res, next) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing Razorpay verification fields' });
    }

    const ok = paymentService.verifyCheckoutSignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });
    if (!ok) return res.status(400).json({ ok: false, error: 'Invalid signature' });

    await paymentService.recordVerifiedPayment({
      userId: req.user.id,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// req.body is a raw Buffer here (rawJsonBody middleware).
async function webhook(req, res) {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBuffer = req.body;

    const ok = paymentService.verifyWebhookSignature(rawBuffer, signature);
    if (!ok) {
      logger.warn('Razorpay webhook signature mismatch');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBuffer.toString('utf8'));
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    // Acknowledge fast so Razorpay doesn't retry; process async.
    res.status(200).json({ received: true });
    paymentService.handleWebhookEvent(event).catch((e) => logger.error('webhook handler error:', e));
  } catch (err) {
    logger.error('webhook fatal:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = { createOrder, verify, webhook };
