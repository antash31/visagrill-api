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

module.exports = { createInterview, listHistory, assertOwnedInterview, finalizeInterview };
