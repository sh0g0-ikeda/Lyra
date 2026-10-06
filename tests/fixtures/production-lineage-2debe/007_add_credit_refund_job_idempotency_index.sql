-- lyra:migration no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_ledger_user_job_type
  ON credit_ledger(user_id, job_id, type)
  WHERE job_id IS NOT NULL;
