CREATE TABLE mobile_push_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_job_id UUID NOT NULL
    REFERENCES generation_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  terminal_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mobile_push_notification_outbox_terminal_status_check
    CHECK (terminal_status IN ('completed', 'failed')),
  UNIQUE (generation_job_id, terminal_status)
);

CREATE INDEX idx_mobile_push_notification_outbox_user_created
  ON mobile_push_notification_outbox (user_id, created_at DESC, id DESC);

CREATE INDEX idx_mobile_push_notification_outbox_organization_created
  ON mobile_push_notification_outbox (organization_id, created_at DESC, id DESC)
  WHERE organization_id IS NOT NULL;

CREATE TABLE mobile_push_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID NOT NULL
    REFERENCES mobile_push_notification_outbox(id) ON DELETE CASCADE,
  push_token_id UUID
    REFERENCES mobile_push_tokens(id) ON DELETE SET NULL,
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
    CHECK (status IN ('pending', 'processing', 'sent', 'dead', 'canceled')),
  CONSTRAINT mobile_push_notification_deliveries_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT mobile_push_notification_deliveries_error_code_check
    CHECK (
      error_code IS NULL
      OR error_code ~ '^[A-Z0-9_]{1,80}$'
    ),
  CONSTRAINT mobile_push_notification_deliveries_timestamps_check
    CHECK (
      available_at >= created_at
      AND updated_at >= created_at
      AND (locked_at IS NULL OR (
        locked_at >= created_at
        AND updated_at >= locked_at
      ))
      AND (sent_at IS NULL OR (
        sent_at >= created_at
        AND updated_at >= sent_at
      ))
    ),
  CONSTRAINT mobile_push_notification_deliveries_state_check
    CHECK (
      (
        status = 'pending'
        AND locked_at IS NULL
        AND lease_token IS NULL
        AND sent_at IS NULL
      )
      OR (
        status = 'processing'
        AND locked_at IS NOT NULL
        AND lease_token IS NOT NULL
        AND sent_at IS NULL
        AND attempt_count > 0
      )
      OR (
        status = 'sent'
        AND locked_at IS NULL
        AND lease_token IS NULL
        AND sent_at IS NOT NULL
        AND attempt_count > 0
        AND error_code IS NULL
      )
      OR (
        status = 'dead'
        AND locked_at IS NULL
        AND lease_token IS NULL
        AND sent_at IS NULL
        AND attempt_count > 0
        AND error_code IS NOT NULL
      )
      OR (
        status = 'canceled'
        AND locked_at IS NULL
        AND lease_token IS NULL
        AND sent_at IS NULL
      )
    ),
  UNIQUE (outbox_id, push_token_id)
);

CREATE INDEX idx_mobile_push_notification_deliveries_claim
  ON mobile_push_notification_deliveries (status, available_at, id)
  WHERE status IN ('pending', 'processing');
