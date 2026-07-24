ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancel_requested_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS commit_started_at timestamptz NULL;

ALTER TABLE generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_cancel_request_metadata_check;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_cancel_request_metadata_check
  CHECK (
    (cancel_requested_at IS NULL AND cancel_requested_by IS NULL)
    OR (cancel_requested_at IS NOT NULL AND cancel_requested_by IS NOT NULL)
  ) NOT VALID;

ALTER TABLE generation_jobs
  VALIDATE CONSTRAINT generation_jobs_cancel_request_metadata_check;

CREATE INDEX IF NOT EXISTS idx_generation_jobs_processing_cancellation_requested
  ON generation_jobs (cancel_requested_at, id)
  WHERE status = 'processing'
    AND cancel_requested_at IS NOT NULL;
