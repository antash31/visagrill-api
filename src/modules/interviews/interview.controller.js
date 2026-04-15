'use strict';

const interviewService = require('./interview.service');

async function init(req, res, next) {
  try {
    const { visa_category_id, scenario_context } = req.body || {};
    if (!visa_category_id) return res.status(400).json({ error: 'visa_category_id is required' });

    const row = await interviewService.createInterview({
      userId: req.user.id,
      visaCategoryId: visa_category_id,
      scenarioContext: scenario_context || {},
    });

    res.status(201).json({
      interview_id: row.id,
      status: row.status,
      scenario_context: row.scenario_context,
    });
  } catch (err) {
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
