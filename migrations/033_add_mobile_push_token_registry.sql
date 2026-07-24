CREATE TABLE IF NOT EXISTS mobile_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id UUID NOT NULL,
  platform TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mobile_push_tokens_platform_check
    CHECK (platform IN ('ios', 'android')),
  CONSTRAINT mobile_push_tokens_token_hash_length_check
    CHECK (octet_length(token_hash) BETWEEN 32 AND 256),
  CONSTRAINT mobile_push_tokens_ciphertext_length_check
    CHECK (octet_length(token_ciphertext) BETWEEN 16 AND 16384),
  CONSTRAINT mobile_push_tokens_key_id_length_check
    CHECK (octet_length(encryption_key_id) BETWEEN 1 AND 256),
  UNIQUE (token_hash),
  UNIQUE (user_id, installation_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_user_updated
  ON mobile_push_tokens (user_id, updated_at DESC);
