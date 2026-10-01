ALTER TABLE mobile_push_tokens
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'ja';

ALTER TABLE mobile_push_tokens
  DROP CONSTRAINT IF EXISTS mobile_push_tokens_locale_check;

ALTER TABLE mobile_push_tokens
  ADD CONSTRAINT mobile_push_tokens_locale_check
    CHECK (locale IN ('ja', 'en'));

CREATE TABLE IF NOT EXISTS mobile_push_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_job_id UUID NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terminal_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mobile_push_notification_outbox_terminal_status_check
    CHECK (terminal_status IN ('completed', 'failed')),
  UNIQUE (generation_job_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_notification_outbox_user_created
  ON mobile_push_notification_outbox (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mobile_push_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID NOT NULL REFERENCES mobile_push_notification_outbox(id) ON DELETE CASCADE,
  push_token_id UUID REFERENCES mobile_push_tokens(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  lease_token UUID,
  sent_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mobile_push_notification_deliveries_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'dead')),
  CONSTRAINT mobile_push_notification_deliveries_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT mobile_push_notification_deliveries_error_code_length_check
    CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 100),
  UNIQUE (outbox_id, push_token_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_notification_deliveries_claim
  ON mobile_push_notification_deliveries (status, available_at, id)
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION enqueue_mobile_push_notification_for_terminal_job()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  created_outbox_id UUID;
BEGIN
  IF NEW.status IN ('completed', 'failed')
     AND OLD.status NOT IN ('completed', 'failed')
     AND OLD.status <> 'canceled' THEN
    INSERT INTO mobile_push_notification_outbox (
      generation_job_id,
      user_id,
      terminal_status
    )
    VALUES (NEW.id, NEW.user_id, NEW.status)
    ON CONFLICT (generation_job_id) DO NOTHING
    RETURNING id INTO created_outbox_id;

    IF created_outbox_id IS NOT NULL THEN
      INSERT INTO mobile_push_notification_deliveries (outbox_id, push_token_id)
      SELECT created_outbox_id, mobile_push_tokens.id
      FROM mobile_push_tokens
      WHERE mobile_push_tokens.user_id = NEW.user_id
      ON CONFLICT (outbox_id, push_token_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generation_jobs_enqueue_mobile_push_notification ON generation_jobs;

CREATE TRIGGER generation_jobs_enqueue_mobile_push_notification
AFTER UPDATE OF status ON generation_jobs
FOR EACH ROW
EXECUTE FUNCTION enqueue_mobile_push_notification_for_terminal_job();
