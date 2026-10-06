ALTER TABLE episode_export_jobs
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN processing_lease_token UUID,
  ADD COLUMN processing_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN last_heartbeat_at TIMESTAMPTZ;

ALTER TABLE episode_export_jobs
  ADD CONSTRAINT episode_export_jobs_attempt_count_check
    CHECK (attempt_count BETWEEN 0 AND 100),
  ADD CONSTRAINT episode_export_jobs_processing_lease_check
    CHECK (
      (
        status = 'processing'
        AND processing_lease_token IS NOT NULL
        AND processing_lease_expires_at IS NOT NULL
        AND last_heartbeat_at IS NOT NULL
        AND started_at IS NOT NULL
        AND last_heartbeat_at >= started_at
        AND processing_lease_expires_at > last_heartbeat_at
        AND processing_lease_expires_at
          <= last_heartbeat_at + INTERVAL '30 minutes'
      )
      OR (
        status <> 'processing'
        AND processing_lease_token IS NULL
        AND processing_lease_expires_at IS NULL
        AND last_heartbeat_at IS NULL
      )
    ) NOT VALID;

CREATE INDEX idx_episode_export_jobs_expired_processing_lease
  ON episode_export_jobs (processing_lease_expires_at ASC)
  WHERE status = 'processing';
