-- Read-only release metadata, suitable for an already-authorized database session.
-- Never put connection strings, credentials, row content, or personal identifiers
-- in this file. The caller must print a generic failure message, not raw errors.
BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

SELECT COALESCE(jsonb_agg(filename ORDER BY filename), '[]'::jsonb) AS applied_migrations
FROM schema_migrations;

SELECT relname AS table_name,
       n_live_tup AS estimated_rows,
       n_dead_tup AS estimated_dead_rows,
       pg_total_relation_size(relid) AS total_bytes
FROM pg_stat_user_tables
WHERE schemaname = CURRENT_SCHEMA()
  AND relname IN ('entity_states', 'episodes', 'generation_jobs', 'credit_ledger', 'account_deletion_requests')
ORDER BY relname;

COMMIT;
