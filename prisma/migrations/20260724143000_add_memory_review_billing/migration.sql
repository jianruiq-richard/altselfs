DO $$
BEGIN
  IF to_regclass('public.agent_memory_review_jobs') IS NOT NULL THEN
    ALTER TABLE agent_memory_review_jobs
      ADD COLUMN IF NOT EXISTS run_id TEXT,
      ADD COLUMN IF NOT EXISTS investor_id TEXT,
      ADD COLUMN IF NOT EXISTS hermes_model TEXT,
      ADD COLUMN IF NOT EXISTS usage JSONB,
      ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'skipped',
      ADD COLUMN IF NOT EXISTS billing_attempts INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS billed_credits INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS billing_error TEXT,
      ADD COLUMN IF NOT EXISTS billing_updated_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS agent_memory_review_jobs_billing_idx
      ON agent_memory_review_jobs (billing_status, billing_updated_at, created_at);
  END IF;
END
$$;
