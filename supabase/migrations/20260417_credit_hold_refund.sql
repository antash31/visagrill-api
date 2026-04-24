-- =============================================================================
-- Migration: Credit Hold / Refund System
-- Adds idempotency_key to interviews, creates atomic RPC functions for
-- deducting and refunding credits with no race conditions.
-- =============================================================================

-- 1. Add idempotency_key column (nullable for legacy rows)
ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;

-- 2. Add interview status values we rely on (if using an enum, extend it;
--    if using plain text, these are just documented values):
--    initialized -> in_progress -> completed | abandoned | failed
-- No schema change needed if status is already a TEXT column.

-- =============================================================================
-- RPC: deduct_credit
--
-- Atomically: check balance >= 1, decrement, create interview row.
-- If the idempotency_key already exists for this user, return the existing
-- interview instead of deducting again.
-- Returns the interview row as JSON.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.deduct_credit(
  p_user_id        UUID,
  p_idempotency_key UUID,
  p_visa_category_id TEXT,
  p_scenario_context JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing RECORD;
  v_new_balance INT;
  v_interview RECORD;
BEGIN
  -- Idempotency check: if this key already exists for the user, return it.
  SELECT id, user_id, visa_category_id, scenario_context, status, created_at
    INTO v_existing
    FROM public.interviews
   WHERE idempotency_key = p_idempotency_key
     AND user_id = p_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id',               v_existing.id,
      'status',           v_existing.status,
      'scenario_context', v_existing.scenario_context,
      'already_existed',  TRUE
    );
  END IF;

  -- Atomic balance decrement with row-level lock.
  UPDATE public.users
     SET available_credits = available_credits - 1
   WHERE id = p_user_id
     AND available_credits >= 1
  RETURNING available_credits INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS'
      USING ERRCODE = 'P0001';
  END IF;

  -- Create the interview row in the same transaction.
  INSERT INTO public.interviews (
    user_id, visa_category_id, scenario_context, status, idempotency_key
  ) VALUES (
    p_user_id, p_visa_category_id, p_scenario_context, 'initialized', p_idempotency_key
  )
  RETURNING id, user_id, visa_category_id, scenario_context, status, created_at
    INTO v_interview;

  RETURN jsonb_build_object(
    'id',               v_interview.id,
    'status',           v_interview.status,
    'scenario_context', v_interview.scenario_context,
    'already_existed',  FALSE
  );
END;
$$;

-- =============================================================================
-- RPC: refund_credit_if_aborted
--
-- Atomically: transition status from 'initialized' -> 'abandoned'.
-- If and only if that row update succeeds (status WAS 'initialized'),
-- add 1 credit back. Prevents double-refund because the WHERE clause
-- on status = 'initialized' will match zero rows on a second call.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.refund_credit_if_aborted(
  p_interview_id UUID,
  p_user_id      UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_updated INT;
BEGIN
  -- Attempt the state transition. Only succeeds if current status is 'initialized'.
  UPDATE public.interviews
     SET status   = 'abandoned',
         ended_at = NOW()
   WHERE id      = p_interview_id
     AND user_id = p_user_id
     AND status  = 'initialized';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    -- Either the interview doesn't exist, doesn't belong to the user,
    -- or was already past 'initialized'. No refund.
    RETURN jsonb_build_object('refunded', FALSE, 'reason', 'not_eligible');
  END IF;

  -- Credit the user back.
  UPDATE public.users
     SET available_credits = available_credits + 1
   WHERE id = p_user_id;

  RETURN jsonb_build_object('refunded', TRUE);
END;
$$;

-- =============================================================================
-- RPC: promote_to_in_progress
--
-- Transition an interview from 'initialized' -> 'in_progress'.
-- This is the Point of No Return — once in_progress, credit is burned.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.promote_to_in_progress(
  p_interview_id UUID,
  p_user_id      UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_updated INT;
BEGIN
  UPDATE public.interviews
     SET status = 'in_progress'
   WHERE id      = p_interview_id
     AND user_id = p_user_id
     AND status  = 'initialized';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  RETURN v_rows_updated > 0;
END;
$$;

-- =============================================================================
-- RPC: cleanup_zombie_interviews
--
-- Finds all interviews stuck in 'initialized' for over 15 minutes and
-- refunds their credits. Called by pg_cron every 15 minutes.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cleanup_zombie_interviews()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
  v_cleaned INT := 0;
BEGIN
  FOR v_row IN
    SELECT id, user_id
      FROM public.interviews
     WHERE status = 'initialized'
       AND created_at < NOW() - INTERVAL '15 minutes'
     FOR UPDATE SKIP LOCKED  -- avoid contention with live requests
  LOOP
    -- Reuse the same atomic refund logic.
    PERFORM public.refund_credit_if_aborted(v_row.id, v_row.user_id);
    v_cleaned := v_cleaned + 1;
  END LOOP;

  RETURN v_cleaned;
END;
$$;
