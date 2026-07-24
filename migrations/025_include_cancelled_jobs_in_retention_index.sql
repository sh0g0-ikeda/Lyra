-- lyra:migration no-transaction

DROP INDEX CONCURRENTLY IF EXISTS idx_generation_jobs_expired_terminal;

CREATE INDEX CONCURRENTLY idx_generation_jobs_expired_terminal
  ON generation_jobs(expires_at, created_at)
  WHERE expires_at IS NOT NULL
    AND status IN ('completed', 'failed', 'cancelled');
