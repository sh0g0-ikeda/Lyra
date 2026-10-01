CREATE TABLE account_deletion_requests (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  identity_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  blocker_codes text[] NOT NULL DEFAULT '{}',
  cancelled_subscription_ids text[] NOT NULL DEFAULT '{}',
  identity_disabled_at timestamptz,
  identity_deleted_at timestamptz,
  scheduled_asset_keys text[] NOT NULL DEFAULT '{}',
  data_anonymized_at timestamptz,
  processing_token uuid,
  processing_started_at timestamptz,
  last_failure_code text,
  retry_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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
