ALTER TABLE mobile_push_notification_outbox
  ADD COLUMN generation_retry_count INTEGER;

UPDATE mobile_push_notification_outbox AS outbox
SET generation_retry_count = CASE
  WHEN generation_jobs.status IN ('queued', 'processing')
    THEN GREATEST(generation_jobs.retry_count - 1, 0)
  ELSE generation_jobs.retry_count
END
FROM generation_jobs
WHERE generation_jobs.id = outbox.generation_job_id;

ALTER TABLE mobile_push_notification_outbox
  ALTER COLUMN generation_retry_count SET DEFAULT 0,
  ALTER COLUMN generation_retry_count SET NOT NULL;

ALTER TABLE mobile_push_notification_outbox
  ADD CONSTRAINT mobile_push_notification_outbox_retry_count_check
  CHECK (generation_retry_count >= 0);

DO $$
DECLARE
  existing_constraint RECORD;
BEGIN
  FOR existing_constraint IN
    SELECT table_constraints.constraint_name
    FROM information_schema.table_constraints
    INNER JOIN LATERAL (
      SELECT ARRAY_AGG(
        key_column_usage.column_name
        ORDER BY key_column_usage.ordinal_position
      ) AS column_names
      FROM information_schema.key_column_usage
      WHERE key_column_usage.constraint_schema = table_constraints.constraint_schema
        AND key_column_usage.constraint_name = table_constraints.constraint_name
        AND key_column_usage.table_schema = table_constraints.table_schema
        AND key_column_usage.table_name = table_constraints.table_name
    ) AS constrained_columns ON TRUE
    WHERE table_constraints.table_schema = CURRENT_SCHEMA()
      AND table_constraints.table_name = 'mobile_push_notification_outbox'
      AND table_constraints.constraint_type = 'UNIQUE'
      AND constrained_columns.column_names IN (
        ARRAY['generation_job_id']::information_schema.sql_identifier[],
        ARRAY[
          'generation_job_id',
          'terminal_status'
        ]::information_schema.sql_identifier[]
      )
  LOOP
    EXECUTE FORMAT(
      'ALTER TABLE mobile_push_notification_outbox DROP CONSTRAINT %I',
      existing_constraint.constraint_name
    );
  END LOOP;
END
$$;

ALTER TABLE mobile_push_notification_outbox
  ADD CONSTRAINT mobile_push_notification_outbox_event_unique
  UNIQUE (generation_job_id, terminal_status, generation_retry_count);
