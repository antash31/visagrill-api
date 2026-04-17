-- =============================================================================
-- pg_cron: Schedule zombie interview cleanup every 15 minutes
--
-- Prerequisites: pg_cron extension must be enabled in Supabase.
--   Dashboard -> Database -> Extensions -> search "pg_cron" -> Enable
--
-- Run this ONCE in the Supabase SQL Editor (as postgres/superuser).
-- =============================================================================

-- Enable the extension (no-op if already enabled).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the job. Runs every 15 minutes, calls the cleanup RPC.
SELECT cron.schedule(
  'cleanup-zombie-interviews',       -- job name
  '*/15 * * * *',                    -- every 15 minutes
  $$SELECT public.cleanup_zombie_interviews()$$
);
