'use strict';

const supabase = require('../../config/supabase.config');

// #genai
const PROFILE_COLUMNS = [
  'id',
  'email',
  'subscription_tier',
  'available_credits',
  'created_at',
  'full_name',
  'date_of_birth',
  'city_in_india',
  'consulate',
  'visa_type',
  'interview_scheduled',
  'interview_date',
  'preferred_language',
  'marital_status',
  'dependents_count',
  'property_in_india',
  'employment_status',
  'employer_name',
  'role_title',
  'salary_range',
  'prior_us_refusal',
  'prior_refusal_details',
  'prior_us_travel',
  'international_travel_countries',
  'visa_details',
  'onboarding_completed',
  'onboarding_step',
  'updated_at',
].join(', ');

// Whitelist of columns a client is allowed to patch via PATCH /api/users/me.
// Anything else in the payload is silently dropped. Notably excludes
// subscription_tier, available_credits, email, id — those are server-owned.
// #genai
const UPDATABLE_COLUMNS = new Set([
  'full_name',
  'date_of_birth',
  'city_in_india',
  'consulate',
  'visa_type',
  'interview_scheduled',
  'interview_date',
  'preferred_language',
  'marital_status',
  'dependents_count',
  'property_in_india',
  'employment_status',
  'employer_name',
  'role_title',
  'salary_range',
  'prior_us_refusal',
  'prior_refusal_details',
  'prior_us_travel',
  'international_travel_countries',
  'visa_details',
  'onboarding_completed',
  'onboarding_step',
]);

async function getProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

// #genai
async function updateProfile(userId, patch) {
  if (!patch || typeof patch !== 'object') {
    const err = new Error('Invalid payload');
    err.status = 400;
    throw err;
  }

  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!UPDATABLE_COLUMNS.has(key)) continue;
    // Normalize empty strings to null so CHECK constraints don't trip.
    clean[key] = value === '' ? null : value;
  }

  if (Object.keys(clean).length === 0) {
    // Nothing to write — return current row so the client can still refresh.
    return getProfile(userId);
  }

  clean.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('users')
    .update(clean)
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

module.exports = { getProfile, updateProfile };
