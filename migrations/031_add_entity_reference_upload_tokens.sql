CREATE TABLE entity_reference_upload_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  s3_key TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT entity_reference_upload_tokens_hash_length_check
    CHECK (char_length(token_hash) = 64),
  CONSTRAINT entity_reference_upload_tokens_purpose_check
    CHECK (purpose IN ('entity_reference_import')),
  CONSTRAINT entity_reference_upload_tokens_mime_type_check
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT entity_reference_upload_tokens_size_check
    CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  CONSTRAINT entity_reference_upload_tokens_tmp_key_check
    CHECK (s3_key LIKE 'tmp/%'),
  CONSTRAINT entity_reference_upload_tokens_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_entity_reference_upload_tokens_pending_expiry
  ON entity_reference_upload_tokens (expires_at ASC)
  WHERE consumed_at IS NULL;
