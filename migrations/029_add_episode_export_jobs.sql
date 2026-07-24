CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  filename TEXT NOT NULL,
  page_ids UUID[] NOT NULL,
  page_snapshot JSONB NOT NULL,
  request_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress_stage TEXT NOT NULL DEFAULT 'queued',
  progress_percent INTEGER NOT NULL DEFAULT 0,
  artifact_s3_key TEXT,
  artifact_mime_type TEXT,
  artifact_size_bytes BIGINT,
  artifact_deleted_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT export_jobs_format_check CHECK (format IN ('pdf', 'zip')),
  CONSTRAINT export_jobs_page_ids_check CHECK (cardinality(page_ids) BETWEEN 1 AND 100),
  CONSTRAINT export_jobs_filename_length_check CHECK (char_length(filename) BETWEEN 1 AND 160),
  CONSTRAINT export_jobs_idempotency_key_length_check CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT export_jobs_status_check CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'canceled')),
  CONSTRAINT export_jobs_progress_percent_check CHECK (progress_percent BETWEEN 0 AND 100),
  CONSTRAINT export_jobs_artifact_size_check CHECK (artifact_size_bytes IS NULL OR artifact_size_bytes > 0),
  CONSTRAINT export_jobs_completed_artifact_check CHECK (
    status <> 'completed' OR (artifact_s3_key IS NOT NULL AND artifact_mime_type IS NOT NULL AND artifact_size_bytes IS NOT NULL)
  ),
  CONSTRAINT export_jobs_expiry_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX idx_export_jobs_idempotency_scope
  ON export_jobs (user_id, COALESCE(organization_id::text, ''), idempotency_key);

CREATE UNIQUE INDEX idx_export_jobs_active_duplicate
  ON export_jobs (episode_id, COALESCE(organization_id::text, ''), request_fingerprint)
  WHERE status IN ('queued', 'processing');

CREATE INDEX idx_export_jobs_scope_created
  ON export_jobs (organization_id, user_id, created_at DESC, id DESC);

CREATE INDEX idx_export_jobs_expired_artifacts
  ON export_jobs (expires_at ASC)
  WHERE artifact_s3_key IS NOT NULL AND artifact_deleted_at IS NULL;

CREATE TABLE export_job_outbox (
  export_job_id UUID PRIMARY KEY REFERENCES export_jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  sqs_message_id TEXT,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  last_dispatch_error TEXT,
  CONSTRAINT export_job_outbox_attempts_check CHECK (dispatch_attempts >= 0)
);

CREATE INDEX idx_export_job_outbox_pending
  ON export_job_outbox (created_at ASC)
  WHERE dispatched_at IS NULL;
