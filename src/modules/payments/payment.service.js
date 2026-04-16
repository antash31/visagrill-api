'use strict';

const crypto = require('crypto');
const razorpay = require('../../config/razorpay.config');
const supabase = require('../../config/supabase.config');
const env = require('../../config/env.config');
const logger = require('../../utils/logger.util');

const PLAN_CATALOG = {
  pro_monthly: { amountPaise: 49900, currency: 'INR', tier: 'pro', credits: 20 },
  pro_yearly: { amountPaise: 499000, currency: 'INR', tier: 'pro', credits: 300 },
  credits_10: { amountPaise: 19900, currency: 'INR', tier: null, credits: 10 },
};

async function createOrder({ userId, planId }) {
  const plan = PLAN_CATALOG[planId];
  if (!plan) {
    const err = new Error(`Unknown plan_id: ${planId}`);
    err.status = 400;
    throw err;
  }

  const order = await razorpay.orders.create({
    amount: plan.amountPaise,
    currency: plan.currency,
    receipt: `rcpt_${userId}_${Date.now()}`,
    notes: { user_id: userId, plan_id: planId },
  });

  const { error } = await supabase.from('transactions').insert({
    razorpay_order_id: order.id,
    user_id: userId,
    plan_id: planId,
    amount: plan.amountPaise,
    currency: plan.currency,
    status: 'created',
  });
  if (error) logger.warn('transactions insert failed (non-fatal):', error.message);

  return { order, plan };
}

function verifyCheckoutSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(razorpay_signature || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function recordVerifiedPayment({ userId, orderId, paymentId }) {
  const { error } = await supabase
    .from('transactions')
    .update({ status: 'paid', razorpay_payment_id: paymentId, paid_at: new Date().toISOString() })
    .eq('razorpay_order_id', orderId)
    .eq('user_id', userId);
  if (error) logger.warn('transactions update failed:', error.message);
}

function verifyWebhookSignature(rawBodyBuffer, signatureHeader) {
  if (!rawBodyBuffer || !signatureHeader) return false;

  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBodyBuffer)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signatureHeader), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function applyEntitlementsForOrder(orderId) {
  const { data: row, error } = await supabase
    .from('transactions')
    .select('user_id, plan_id')
    .eq('razorpay_order_id', orderId)
    .single();

  if (error || !row) {
    logger.warn('applyEntitlementsForOrder: order not found', orderId, error && error.message);
    return;
  }

  const plan = PLAN_CATALOG[row.plan_id];
  if (!plan) {
    logger.warn('applyEntitlementsForOrder: unknown plan_id on stored order', row.plan_id);
    return;
  }

  const patch = {};
  if (plan.tier) patch.subscription_tier = plan.tier;

  if (plan.credits) {
    const { data: user } = await supabase
      .from('users')
      .select('available_credits')
      .eq('id', row.user_id)
      .single();
    const current = (user && user.available_credits) || 0;
    patch.available_credits = current + plan.credits;
  }

  const { error: upErr } = await supabase.from('users').update(patch).eq('id', row.user_id);
  if (upErr) logger.error('Failed to apply entitlements:', upErr.message);
}

async function handleWebhookEvent(event) {
  const type = event && event.event;
  logger.info('Razorpay webhook event:', type);

  if (type === 'payment.captured') {
    const payment = event.payload && event.payload.payment && event.payload.payment.entity;
    if (payment && payment.order_id) {
      await applyEntitlementsForOrder(payment.order_id);
    }
  }
  // Other events (payment.failed, order.paid, refund.*) can be handled here.
}

module.exports = {
  createOrder,
  verifyCheckoutSignature,
  recordVerifiedPayment,
  verifyWebhookSignature,
  handleWebhookEvent,
  PLAN_CATALOG,
};
