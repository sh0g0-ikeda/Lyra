CREATE TABLE account_deletion_requests (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  identity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  blocker_codes TEXT[] NOT NULL DEFAULT '{}',
  cancelled_subscription_ids TEXT[] NOT NULL DEFAULT '{}',
  identity_disabled_at TIMESTAMPTZ,
  identity_deleted_at TIMESTAMPTZ,
  scheduled_asset_keys TEXT[] NOT NULL DEFAULT '{}',
  data_anonymized_at TIMESTAMPTZ,
  processing_token UUID,
  processing_started_at TIMESTAMPTZ,
  last_failure_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_deletion_requests_status_check
    CHECK (status IN ('blocked', 'processing', 'pending_external_action', 'completed')),
  CONSTRAINT account_deletion_requests_retry_count_check CHECK (retry_count >= 0),
  CONSTRAINT account_deletion_requests_processing_claim_check
    CHECK ((processing_token IS NULL) = (processing_started_at IS NULL)),
  CONSTRAINT account_deletion_requests_blocker_code_length_check
    CHECK (array_length(blocker_codes, 1) IS NULL OR array_length(blocker_codes, 1) <= 16)
);

CREATE INDEX idx_account_deletion_requests_pending
  ON account_deletion_requests (updated_at ASC)
  WHERE status IN ('processing', 'pending_external_action');
