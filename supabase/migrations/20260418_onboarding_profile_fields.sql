-- =============================================================================
-- Migration: Onboarding Profile Fields
-- Extends public.users with the columns needed to personalize the AI mock
-- interview. All new columns are nullable so the wizard can be skipped at
-- any step without blocking signup. Visa-type-specific fields (F1 vs B1/B2)
-- live in `visa_details` jsonb to keep the table flat.
-- =============================================================================
-- #genai

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS full_name                    text,
  ADD COLUMN IF NOT EXISTS date_of_birth                date,
  ADD COLUMN IF NOT EXISTS city_in_india                text,
  ADD COLUMN IF NOT EXISTS consulate                    text,
  ADD COLUMN IF NOT EXISTS visa_type                    text,
  ADD COLUMN IF NOT EXISTS interview_scheduled          boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS interview_date               date,
  ADD COLUMN IF NOT EXISTS preferred_language           text        DEFAULT 'english',
  ADD COLUMN IF NOT EXISTS marital_status               text,
  ADD COLUMN IF NOT EXISTS dependents_count             smallint    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS property_in_india            boolean,
  ADD COLUMN IF NOT EXISTS employment_status            text,
  ADD COLUMN IF NOT EXISTS employer_name                text,
  ADD COLUMN IF NOT EXISTS role_title                   text,
  ADD COLUMN IF NOT EXISTS salary_range                 text,
  ADD COLUMN IF NOT EXISTS prior_us_refusal             boolean,
  ADD COLUMN IF NOT EXISTS prior_refusal_details        text,
  ADD COLUMN IF NOT EXISTS prior_us_travel              boolean,
  ADD COLUMN IF NOT EXISTS international_travel_countries text[],
  ADD COLUMN IF NOT EXISTS visa_details                 jsonb       DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_completed         boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step              smallint    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at                   timestamptz DEFAULT now();

-- Loose CHECK constraints on enum-ish columns. Kept permissive (allow NULL)
-- because the wizard saves partial progress.
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_visa_type_check,
  ADD  CONSTRAINT users_visa_type_check
       CHECK (visa_type IS NULL OR visa_type IN ('F1','B1','B2','B1B2','J1','H1B','Other'));

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_consulate_check,
  ADD  CONSTRAINT users_consulate_check
       CHECK (consulate IS NULL OR consulate IN ('mumbai','delhi','chennai','kolkata','hyderabad'));

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_preferred_language_check,
  ADD  CONSTRAINT users_preferred_language_check
       CHECK (preferred_language IS NULL OR preferred_language IN ('english','hinglish'));

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_marital_status_check,
  ADD  CONSTRAINT users_marital_status_check
       CHECK (marital_status IS NULL OR marital_status IN ('single','married','divorced'));

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_employment_status_check,
  ADD  CONSTRAINT users_employment_status_check
       CHECK (employment_status IS NULL OR employment_status IN ('employed','student','self_employed','unemployed'));

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_onboarding_step_check,
  ADD  CONSTRAINT users_onboarding_step_check
       CHECK (onboarding_step BETWEEN 0 AND 3);

-- Index so the dashboard nag query stays fast as the users table grows.
CREATE INDEX IF NOT EXISTS users_onboarding_completed_idx
  ON public.users (onboarding_completed)
  WHERE onboarding_completed = false;
