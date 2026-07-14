ALTER TABLE generation_jobs
  ADD COLUMN cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN cancel_requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN commit_started_at TIMESTAMPTZ;

ALTER TABLE generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_status_check;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')) NOT VALID;

ALTER TABLE generation_jobs VALIDATE CONSTRAINT generation_jobs_status_check;
