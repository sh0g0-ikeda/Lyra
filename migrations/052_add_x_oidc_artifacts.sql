-- X federation artifacts contain encrypted payloads, never raw tokens or emails.
-- This independent table is additive for both canonical and expanded databases.
CREATE TABLE x_oidc_artifacts (
  kind TEXT NOT NULL CHECK (kind IN ('state', 'email', 'code', 'access', 'delivery')),
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  binding_hash TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  proof_hash TEXT,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX x_oidc_artifacts_expiry_idx ON x_oidc_artifacts (expires_at);
