-- lyra:migration no-transaction
-- This migration adds only the persistence required for per-user history
-- visibility. Cancellation/refund behavior remains owned by the existing
-- service and repository until its lock ordering is reviewed separately.

CREATE TABLE IF NOT EXISTS generation_job_history_hides (
  generation_job_id uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (generation_job_id, user_id)
);

DROP INDEX CONCURRENTLY IF EXISTS idx_generation_job_history_hides_user_job;
CREATE INDEX CONCURRENTLY idx_generation_job_history_hides_user_job
  ON generation_job_history_hides (user_id, generation_job_id);

DROP INDEX CONCURRENTLY IF EXISTS idx_generation_jobs_scope_created;
CREATE INDEX CONCURRENTLY idx_generation_jobs_scope_created
  ON generation_jobs (organization_id, user_id, created_at DESC, id DESC);

