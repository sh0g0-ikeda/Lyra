-- Additive, dormant until Google identity-link configuration and flags are set.
-- OAuth exchange material is encrypted by the application, never a raw token.
CREATE TABLE oauth_link_challenges (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'Google'),
  request_key UUID NOT NULL,
  session_hash TEXT NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  state_hash TEXT NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  email_hash TEXT NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  native_subject TEXT NOT NULL CHECK (char_length(native_subject) BETWEEN 1 AND 256),
  native_username TEXT NOT NULL CHECK (char_length(native_username) BETWEEN 1 AND 256),
  exchange_material TEXT CHECK (exchange_material IS NULL OR char_length(exchange_material) BETWEEN 64 AND 4096),
  platform TEXT NOT NULL CHECK (platform IN ('mobile', 'web')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'linked', 'cancelled', 'expired', 'failed', 'recovery_required')),
  provider_subject_hash TEXT CHECK (provider_subject_hash IS NULL OR provider_subject_hash ~ '^[0-9a-f]{64}$'),
  message_code TEXT CHECK (message_code IS NULL OR message_code IN ('EMAIL_MISMATCH', 'LINK_CONFLICT', 'GOOGLE_LINK_FAILED', 'RECOVERY_REQUIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, request_key),
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '10 minutes'),
  CHECK (status = 'pending' OR consumed_at IS NOT NULL)
);

CREATE TABLE oauth_identity_links (
  provider TEXT NOT NULL CHECK (provider = 'Google'),
  provider_subject_hash TEXT NOT NULL CHECK (provider_subject_hash ~ '^[0-9a-f]{64}$'),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id UUID REFERENCES oauth_link_challenges(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'linked', 'recovery_required')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(provider, provider_subject_hash),
  UNIQUE(user_id, provider)
);

CREATE FUNCTION lyra_guard_oauth_identity_user() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE active_user BOOLEAN;
BEGIN
  SELECT account_deletion_started_at IS NULL AND account_deleted_at IS NULL
    INTO active_user FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF active_user IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Account is unavailable for identity linking' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER oauth_link_challenges_active_user BEFORE INSERT OR UPDATE ON oauth_link_challenges
  FOR EACH ROW EXECUTE FUNCTION lyra_guard_oauth_identity_user();
CREATE TRIGGER oauth_identity_links_active_user BEFORE INSERT OR UPDATE ON oauth_identity_links
  FOR EACH ROW EXECUTE FUNCTION lyra_guard_oauth_identity_user();

-- Account deletion anonymizes the user anchor rather than deleting it. Remove
-- all short-lived exchange material and identity-link rows at that same gate.
CREATE FUNCTION lyra_clear_oauth_identity_on_deletion() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM oauth_identity_links WHERE user_id = NEW.id;
  DELETE FROM oauth_link_challenges WHERE user_id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_clear_oauth_identity_on_deletion AFTER UPDATE OF account_deletion_started_at ON users
  FOR EACH ROW WHEN (NEW.account_deletion_started_at IS NOT NULL AND OLD.account_deletion_started_at IS NULL)
  EXECUTE FUNCTION lyra_clear_oauth_identity_on_deletion();
