CREATE TABLE mobile_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id UUID NOT NULL,
  platform TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'ja',
  token_hash TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mobile_push_tokens_platform_check
    CHECK (platform IN ('ios', 'android')),
  CONSTRAINT mobile_push_tokens_locale_check
    CHECK (locale IN ('ja', 'en')),
  CONSTRAINT mobile_push_tokens_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mobile_push_tokens_ciphertext_check
    CHECK (
      char_length(token_ciphertext) BETWEEN 64 AND 16384
      AND token_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$'
    ),
  CONSTRAINT mobile_push_tokens_key_id_check
    CHECK (encryption_key_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  CONSTRAINT mobile_push_tokens_timestamps_check
    CHECK (updated_at >= created_at),
  UNIQUE (token_hash),
  UNIQUE (user_id, installation_id)
);

CREATE INDEX idx_mobile_push_tokens_user_updated
  ON mobile_push_tokens (user_id, updated_at DESC, id DESC);
