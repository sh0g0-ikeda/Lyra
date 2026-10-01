-- lyra:migration no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_expired_terminal
  ON generation_jobs(expires_at, created_at)
  WHERE expires_at IS NOT NULL
    AND status IN ('completed', 'failed');
