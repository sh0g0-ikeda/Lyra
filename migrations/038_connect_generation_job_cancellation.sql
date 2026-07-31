-- Credit consumption locks the personal or organization balance before the
-- ledger insert. This guard then locks the referenced job in the same order as
-- cancellation settlement and rejects a consume that lost the cancellation
-- race. It intentionally never mutates balances or performs refunds.

CREATE OR REPLACE FUNCTION guard_generation_job_credit_consume()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  locked_job generation_jobs%ROWTYPE;
BEGIN
  IF NEW.type <> 'consume' OR NEW.job_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO locked_job
  FROM generation_jobs
  WHERE id = NEW.job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (
      locked_job.organization_id IS NULL
      AND NEW.organization_id IS NULL
      AND NEW.user_id = locked_job.user_id
    )
    OR (
      locked_job.organization_id IS NOT NULL
      AND NEW.organization_id = locked_job.organization_id
    )
  ) THEN
    RAISE EXCEPTION 'Generation job credit scope does not match the ledger row'
      USING ERRCODE = '23514',
            CONSTRAINT = 'generation_job_credit_consume_scope';
  END IF;

  IF locked_job.status = 'cancelled'
     OR locked_job.cancel_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'Generation job was cancelled before credit consumption'
      USING ERRCODE = 'P0001',
            CONSTRAINT = 'generation_job_credit_consume_active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generation_job_credit_consume_guard ON credit_ledger;

CREATE TRIGGER generation_job_credit_consume_guard
BEFORE INSERT ON credit_ledger
FOR EACH ROW
EXECUTE FUNCTION guard_generation_job_credit_consume();
