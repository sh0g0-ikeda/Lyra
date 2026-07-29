ALTER TABLE generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_status_check;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'canceled')) NOT VALID;

ALTER TABLE generation_jobs
  VALIDATE CONSTRAINT generation_jobs_status_check;

CREATE TABLE IF NOT EXISTS generation_job_history_hides (
  generation_job_id uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (generation_job_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_generation_job_history_hides_user_job
  ON generation_job_history_hides (user_id, generation_job_id);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_scope_created
  ON generation_jobs (organization_id, user_id, created_at DESC, id DESC);

-- A queued job can be cancelled after its row has been created but before an
-- older producer finishes writing its consume ledger row. Refund that late
-- consume in the same ledger transaction so cancellation remains idempotent.
CREATE OR REPLACE FUNCTION refund_late_canceled_generation_job_consume()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  canceled boolean;
  refund_monthly integer;
  refund_purchased integer;
  next_monthly integer;
  next_purchased integer;
  monthly_expired boolean;
BEGIN
  IF NEW.type <> 'consume' OR NEW.job_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status = 'canceled'
  INTO canceled
  FROM generation_jobs
  WHERE id = NEW.job_id
  FOR UPDATE;

  IF COALESCE(canceled, false) = false THEN
    RETURN NEW;
  END IF;

  refund_monthly := GREATEST(0, -COALESCE(NEW.monthly_delta, 0));
  refund_purchased := GREATEST(0, -COALESCE(NEW.purchased_delta, 0));
  IF refund_monthly + refund_purchased = 0 THEN
    refund_purchased := ABS(NEW.amount);
  END IF;

  IF NEW.organization_id IS NULL THEN
    SELECT monthly_expires_at IS NOT NULL AND monthly_expires_at <= NOW()
    INTO monthly_expired
    FROM credit_balances
    WHERE user_id = NEW.user_id
    FOR UPDATE;

    IF COALESCE(monthly_expired, false) THEN
      refund_purchased := refund_purchased + refund_monthly;
      refund_monthly := 0;
    END IF;

    UPDATE credit_balances
    SET monthly_credits = CASE WHEN COALESCE(monthly_expired, false) THEN 0 ELSE monthly_credits + refund_monthly END,
        purchased_credits = purchased_credits + refund_purchased,
        updated_at = NOW()
    WHERE user_id = NEW.user_id
    RETURNING monthly_credits, purchased_credits INTO next_monthly, next_purchased;
  ELSE
    SELECT monthly_expires_at IS NOT NULL AND monthly_expires_at <= NOW()
    INTO monthly_expired
    FROM organization_credit_balances
    WHERE organization_id = NEW.organization_id
    FOR UPDATE;

    IF COALESCE(monthly_expired, false) THEN
      refund_purchased := refund_purchased + refund_monthly;
      refund_monthly := 0;
    END IF;

    UPDATE organization_credit_balances
    SET monthly_credits = CASE WHEN COALESCE(monthly_expired, false) THEN 0 ELSE monthly_credits + refund_monthly END,
        purchased_credits = purchased_credits + refund_purchased,
        updated_at = NOW()
    WHERE organization_id = NEW.organization_id
    RETURNING monthly_credits, purchased_credits INTO next_monthly, next_purchased;
  END IF;

  INSERT INTO credit_ledger (
    user_id, organization_id, type, amount, monthly_delta, purchased_delta,
    monthly_after, purchased_after, description, job_id
  )
  VALUES (
    NEW.user_id, NEW.organization_id, 'refund', refund_monthly + refund_purchased,
    refund_monthly, refund_purchased, next_monthly, next_purchased,
    'Automatic refund for canceled generation job', NEW.job_id
  );

  IF NEW.organization_id IS NOT NULL THEN
    INSERT INTO organization_usage_events (
      organization_id, user_id, generation_job_id, event_type, credit_amount, metadata
    )
    VALUES (
      NEW.organization_id, NEW.user_id, NEW.job_id,
      'generation.canceled_late_credit_refunded', 0,
      jsonb_build_object('credits_refunded', refund_monthly + refund_purchased)
    );

    INSERT INTO organization_audit_logs (
      organization_id, actor_user_id, action, target_type, target_id, metadata
    )
    VALUES (
      NEW.organization_id, NEW.user_id, 'generation.canceled_late_credit_refunded',
      'generation_job', NEW.job_id,
      jsonb_build_object('credits_refunded', refund_monthly + refund_purchased)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generation_job_late_consume_refund ON credit_ledger;

CREATE TRIGGER generation_job_late_consume_refund
AFTER INSERT ON credit_ledger
FOR EACH ROW
EXECUTE FUNCTION refund_late_canceled_generation_job_consume();
