'use strict';

const interviewService = require('./interview.service');

async function init(req, res, next) {
  try {
    const { visa_category_id, scenario_context, idempotency_key } = req.body || {};
    if (!visa_category_id) return res.status(400).json({ error: 'visa_category_id is required' });
    if (!idempotency_key) return res.status(400).json({ error: 'idempotency_key is required' });

    const row = await interviewService.deductCreditAndCreate({
      userId: req.user.id,
      idempotencyKey: idempotency_key,
      visaCategoryId: visa_category_id,
      scenarioContext: scenario_context || {},
    });

    // 200 if idempotent replay, 201 if freshly created
    const status = row.already_existed ? 200 : 201;

    res.status(status).json({
      interview_id: row.id,
      status: row.status,
      scenario_context: row.scenario_context,
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ error: 'Insufficient credits' });
    }
    next(err);
  }
}

async function history(req, res, next) {
  try {
    const items = await interviewService.listHistory({ userId: req.user.id });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

module.exports = { init, history };
