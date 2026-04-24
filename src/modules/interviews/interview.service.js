'use strict';

const supabase = require('../../config/supabase.config');
const logger = require('../../utils/logger.util');

async function createInterview({ userId, visaCategoryId, scenarioContext }) {
  const { data, error } = await supabase
    .from('interviews')
    .insert({
      user_id: userId,
      visa_category_id: visaCategoryId,
      scenario_context: scenarioContext || {},
      status: 'initialized',
    })
    .select('id, user_id, visa_category_id, scenario_context, status, created_at')
    .single();

  if (error) throw error;
  return data;
}

/**
 * Atomically deduct 1 credit and create an interview row.
 * Idempotent: if the idempotency_key already exists, returns the existing interview.
 * Throws with code 'INSUFFICIENT_CREDITS' if balance < 1.
 */
async function deductCreditAndCreate({ userId, idempotencyKey, visaCategoryId, scenarioContext }) {
  const { data, error } = await supabase.rpc('deduct_credit', {
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
    p_visa_category_id: visaCategoryId,
    p_scenario_context: scenarioContext || {},
  });

  if (error) {
    // Supabase wraps PL/pgSQL RAISE EXCEPTION in error.message
    if (error.message && error.message.includes('INSUFFICIENT_CREDITS')) {
      const err = new Error('Insufficient credits');
      err.code = 'INSUFFICIENT_CREDITS';
      throw err;
    }
    throw error;
  }

  return data; // { id, status, scenario_context, already_existed }
}

/**
 * Atomically refund a credit if the interview is still in 'initialized' status.
 * Safe to call multiple times — only the first call refunds.
 */
async function refundCreditIfAborted({ interviewId, userId }) {
  const { data, error } = await supabase.rpc('refund_credit_if_aborted', {
    p_interview_id: interviewId,
    p_user_id: userId,
  });

  if (error) {
    logger.error('refundCreditIfAborted RPC failed:', error.message);
    throw error;
  }

  return data; // { refunded: true/false, reason?: string }
}

/**
 * Promote interview from 'initialized' to 'in_progress'.
 * This is the Point of No Return — credit is permanently burned.
 */
async function promoteToInProgress({ interviewId, userId }) {
  const { data, error } = await supabase.rpc('promote_to_in_progress', {
    p_interview_id: interviewId,
    p_user_id: userId,
  });

  if (error) {
    logger.error('promoteToInProgress RPC failed:', error.message);
    throw error;
  }

  return data; // boolean: true if promoted, false if already past initialized
}

async function listHistory({ userId, limit = 50 }) {
  const { data, error } = await supabase
    .from('interviews')
    .select('id, visa_category_id, status, created_at, ended_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function assertOwnedInterview({ interviewId, userId }) {
  const { data, error } = await supabase
    .from('interviews')
    .select('id, user_id, scenario_context')
    .eq('id', interviewId)
    .single();

  if (error || !data) throw new Error('Interview not found');
  if (data.user_id !== userId) throw new Error('Forbidden');
  return data;
}

async function finalizeInterview({ interviewId, userId, transcriptLog, feedback }) {
  const patch = {
    transcript_log: transcriptLog || [],
    status: 'completed',
    ended_at: new Date().toISOString(),
  };
  if (feedback) patch.feedback = feedback;

  const { error } = await supabase
    .from('interviews')
    .update(patch)
    .eq('id', interviewId)
    .eq('user_id', userId);

  if (error) {
    logger.error('finalizeInterview failed:', error.message);
    throw error;
  }
}

module.exports = {
  createInterview,
  deductCreditAndCreate,
  refundCreditIfAborted,
  promoteToInProgress,
  listHistory,
  assertOwnedInterview,
  finalizeInterview,
};
