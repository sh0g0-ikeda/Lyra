CREATE TABLE episode_export_jobs (
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
  CONSTRAINT episode_export_jobs_format_check
    CHECK (format IN ('pdf', 'zip')),
  CONSTRAINT episode_export_jobs_page_ids_check
    CHECK (
      cardinality(page_ids) BETWEEN 1 AND 100
      AND array_position(page_ids, NULL) IS NULL
    ),
  CONSTRAINT episode_export_jobs_page_snapshot_check
    CHECK (
      CASE
        WHEN jsonb_typeof(page_snapshot) = 'array'
          THEN jsonb_array_length(page_snapshot) = cardinality(page_ids)
        ELSE FALSE
      END
    ),
  CONSTRAINT episode_export_jobs_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT episode_export_jobs_filename_check
    CHECK (
      char_length(trim(filename)) BETWEEN 1 AND 160
      AND filename = trim(filename)
      AND lower(filename) LIKE ('%.' || format)
      AND filename !~ '[[:cntrl:]]'
      AND position('/' IN filename) = 0
      AND position(chr(92) IN filename) = 0
    ),
  CONSTRAINT episode_export_jobs_idempotency_key_check
    CHECK (
      char_length(idempotency_key) BETWEEN 8 AND 128
      AND idempotency_key !~ '[[:cntrl:]]'
    ),
  CONSTRAINT episode_export_jobs_status_check
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'canceled')),
  CONSTRAINT episode_export_jobs_progress_check
    CHECK (
      progress_percent BETWEEN 0 AND 100
      AND char_length(trim(progress_stage)) BETWEEN 1 AND 80
    ),
  CONSTRAINT episode_export_jobs_error_check
    CHECK (
      (error_code IS NULL OR char_length(trim(error_code)) BETWEEN 1 AND 80)
      AND (error_message IS NULL OR char_length(trim(error_message)) BETWEEN 1 AND 512)
    ),
  CONSTRAINT episode_export_jobs_expiry_check
    CHECK (
      expires_at > created_at
      AND expires_at <= created_at + INTERVAL '24 hours'
    ),
  CONSTRAINT episode_export_jobs_timestamps_check
    CHECK (
      updated_at >= COALESCE(
        artifact_deleted_at,
        completed_at,
        started_at,
        created_at
      )
      AND (started_at IS NULL OR started_at >= created_at)
      AND (
        completed_at IS NULL
        OR completed_at >= COALESCE(started_at, created_at)
      )
      AND (
        artifact_deleted_at IS NULL
        OR (
          completed_at IS NOT NULL
          AND artifact_deleted_at >= expires_at
        )
      )
    ),
  CONSTRAINT episode_export_jobs_artifact_check
    CHECK (
      (
        status = 'completed'
        AND artifact_s3_key IS NOT NULL
        AND artifact_mime_type IS NOT NULL
        AND artifact_size_bytes IS NOT NULL
        AND artifact_s3_key = (
          'exports/' || COALESCE(organization_id::text, user_id::text)
          || '/episodes/' || episode_id::text
          || '/' || id::text || '.' || format
        )
        AND (
          (format = 'pdf' AND artifact_mime_type = 'application/pdf')
          OR (format = 'zip' AND artifact_mime_type = 'application/zip')
        )
        AND artifact_size_bytes BETWEEN 1 AND 134217728
      )
      OR (
        status <> 'completed'
        AND artifact_s3_key IS NULL
        AND artifact_mime_type IS NULL
        AND artifact_size_bytes IS NULL
        AND artifact_deleted_at IS NULL
      )
    ),
  CONSTRAINT episode_export_jobs_state_check
    CHECK (
      (
        status = 'queued'
        AND progress_stage = 'queued'
        AND progress_percent = 0
        AND started_at IS NULL
        AND completed_at IS NULL
        AND error_code IS NULL
        AND error_message IS NULL
      )
      OR (
        status = 'processing'
        AND progress_percent BETWEEN 1 AND 99
        AND started_at IS NOT NULL
        AND completed_at IS NULL
        AND error_code IS NULL
        AND error_message IS NULL
      )
      OR (
        status = 'completed'
        AND progress_stage = 'completed'
        AND progress_percent = 100
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
        AND completed_at < expires_at
        AND error_code IS NULL
        AND error_message IS NULL
      )
      OR (
        status = 'failed'
        AND progress_stage = 'failed'
        AND progress_percent BETWEEN 0 AND 99
        AND completed_at IS NOT NULL
        AND error_code IS NOT NULL
        AND error_message IS NOT NULL
      )
      OR (
        status = 'canceled'
        AND progress_stage = 'canceled'
        AND progress_percent BETWEEN 0 AND 99
        AND completed_at IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX idx_episode_export_jobs_idempotency_scope
  ON episode_export_jobs (
    user_id,
    COALESCE(organization_id::text, ''),
    idempotency_key
  );

CREATE UNIQUE INDEX idx_episode_export_jobs_active_duplicate
  ON episode_export_jobs (
    episode_id,
    COALESCE(organization_id::text, ''),
    request_fingerprint
  )
  WHERE status IN ('queued', 'processing');

CREATE INDEX idx_episode_export_jobs_scope_created
  ON episode_export_jobs (
    organization_id,
    user_id,
    created_at DESC,
    id DESC
  );

CREATE INDEX idx_episode_export_jobs_expired_artifacts
  ON episode_export_jobs (expires_at ASC)
  WHERE artifact_s3_key IS NOT NULL
    AND artifact_deleted_at IS NULL;

CREATE TABLE episode_export_job_outbox (
  export_job_id UUID PRIMARY KEY
    REFERENCES episode_export_jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  sqs_message_id TEXT,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  last_dispatch_error TEXT,
  CONSTRAINT episode_export_job_outbox_attempts_check
    CHECK (dispatch_attempts >= 0),
  CONSTRAINT episode_export_job_outbox_message_id_check
    CHECK (
      sqs_message_id IS NULL
      OR char_length(trim(sqs_message_id)) BETWEEN 1 AND 128
    ),
  CONSTRAINT episode_export_job_outbox_error_check
    CHECK (
      last_dispatch_error IS NULL
      OR char_length(trim(last_dispatch_error)) BETWEEN 1 AND 512
    ),
  CONSTRAINT episode_export_job_outbox_dispatch_check
    CHECK (
      dispatched_at IS NULL
      OR (
        dispatched_at >= created_at
        AND dispatch_attempts > 0
        AND last_dispatch_error IS NULL
      )
    )
);

CREATE INDEX idx_episode_export_job_outbox_pending
  ON episode_export_job_outbox (created_at ASC)
  WHERE dispatched_at IS NULL;
