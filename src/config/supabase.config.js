'use strict';

const { createClient } = require('@supabase/supabase-js');
const env = require('./env.config');

// Service-role client. Bypasses RLS — only use on the server.
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

module.exports = supabase;
