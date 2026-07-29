CREATE OR REPLACE FUNCTION enqueue_mobile_push_notification_for_terminal_job()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  created_outbox_id UUID;
BEGIN
  IF NEW.status IN ('completed', 'failed')
     AND OLD.status NOT IN ('completed', 'failed')
     AND OLD.status <> 'cancelled' THEN
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
