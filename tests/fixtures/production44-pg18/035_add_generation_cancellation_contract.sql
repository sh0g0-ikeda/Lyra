ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_cancel_request_metadata_check
  CHECK (
    (
      (
        cancel_requested_at IS NULL
        AND cancel_requested_by IS NULL
      )
      OR (
        cancel_requested_at IS NOT NULL
        AND cancel_requested_by IS NOT NULL
      )
    )
    AND (
      (cancel_requested_at IS NULL OR cancel_requested_at >= created_at)
      AND (commit_started_at IS NULL OR commit_started_at >= created_at)
      AND (cancel_requested_at IS NULL OR commit_started_at IS NULL)
    )
  ) NOT VALID;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_cancellation_state_check
  CHECK (
    (
      status = 'cancelled'
      AND cancel_requested_at IS NOT NULL
      AND cancel_requested_by IS NOT NULL
      AND cancelled_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND commit_started_at IS NULL
      AND cancelled_at >= cancel_requested_at
      AND completed_at >= cancelled_at
    )
    OR (
      status <> 'cancelled'
      AND cancelled_at IS NULL
    )
  ) NOT VALID;
