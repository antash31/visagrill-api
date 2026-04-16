'use strict';

const supabase = require('../../config/supabase.config');

async function getProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, subscription_tier, available_credits, created_at')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

module.exports = { getProfile };
