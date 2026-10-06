ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_deletion_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_deleted_at TIMESTAMPTZ;

ALTER TABLE users
  ADD CONSTRAINT users_account_deletion_timestamps_check
  CHECK (
    account_deleted_at IS NULL
    OR (
      account_deletion_started_at IS NOT NULL
      AND account_deleted_at >= account_deletion_started_at
    )
  ) NOT VALID;

ALTER TABLE users
  VALIDATE CONSTRAINT users_account_deletion_timestamps_check;

ALTER TABLE account_deletion_requests
  ADD COLUMN IF NOT EXISTS identity_key TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

ALTER TABLE account_deletion_requests
  ADD CONSTRAINT account_deletion_requests_identity_key_shape_check
  CHECK (identity_key IS NULL OR char_length(identity_key) = 43) NOT VALID;

ALTER TABLE account_deletion_requests
  VALIDATE CONSTRAINT account_deletion_requests_identity_key_shape_check;

CREATE UNIQUE INDEX idx_account_deletion_requests_identity_key
  ON account_deletion_requests (identity_key)
  WHERE identity_key IS NOT NULL;

DROP INDEX IF EXISTS idx_account_deletion_requests_pending;
CREATE INDEX idx_account_deletion_requests_pending
  ON account_deletion_requests (
    COALESCE(next_retry_at, updated_at) ASC,
    updated_at ASC,
    user_id ASC
  )
  WHERE status IN ('processing', 'pending_external_action');

CREATE OR REPLACE FUNCTION reject_write_after_account_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  is_personal_write BOOLEAN := TRUE;
BEGIN
  IF TG_TABLE_NAME = 'generation_jobs' THEN
    IF TG_OP = 'UPDATE'
      AND (
        OLD.status IN ('queued', 'processing')
        OR NEW.status NOT IN ('queued', 'processing')
      )
    THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'episode_export_jobs' THEN
    IF TG_OP = 'UPDATE'
      AND (
        OLD.status IN ('queued', 'processing')
        OR NEW.status NOT IN ('queued', 'processing')
      )
    THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'entities' THEN
    SELECT works.organization_id IS NULL
    INTO is_personal_write
    FROM works
    WHERE works.id = NEW.work_id;
  ELSIF TG_TABLE_NAME <> 'mobile_push_tokens' THEN
    is_personal_write := NEW.organization_id IS NULL;
  END IF;

  IF is_personal_write
    AND EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = NEW.user_id
        AND users.account_deletion_started_at IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'account deletion has started'
      USING ERRCODE = '23514',
            CONSTRAINT = 'account_deletion_content_write_guard';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS works_account_deletion_write_guard ON works;
CREATE TRIGGER works_account_deletion_write_guard
  BEFORE INSERT OR UPDATE ON works
  FOR EACH ROW EXECUTE FUNCTION reject_write_after_account_deletion();

DROP TRIGGER IF EXISTS entities_account_deletion_write_guard ON entities;
CREATE TRIGGER entities_account_deletion_write_guard
  BEFORE INSERT OR UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION reject_write_after_account_deletion();

DROP TRIGGER IF EXISTS generation_jobs_account_deletion_write_guard ON generation_jobs;
CREATE TRIGGER generation_jobs_account_deletion_write_guard
  BEFORE INSERT OR UPDATE ON generation_jobs
  FOR EACH ROW EXECUTE FUNCTION reject_write_after_account_deletion();

DROP TRIGGER IF EXISTS entity_reference_upload_tokens_account_deletion_write_guard
  ON entity_reference_upload_tokens;
CREATE TRIGGER entity_reference_upload_tokens_account_deletion_write_guard
  BEFORE INSERT OR UPDATE ON entity_reference_upload_tokens
  FOR EACH ROW EXECUTE FUNCTION reject_write_after_account_deletion();

DROP TRIGGER IF EXISTS episode_export_jobs_account_deletion_write_guard
  ON episode_export_jobs;
CREATE TRIGGER episode_export_jobs_account_deletion_write_guard
  BEFORE INSERT OR UPDATE ON episode_export_jobs
  FOR EACH ROW EXECUTE FUNCTION reject_write_after_account_deletion();

DROP TRIGGER IF EXISTS mobile_push_tokens_account_deletion_write_guard
  ON mobile_push_tokens;
CREATE TRIGGER mobile_push_tokens_account_deletion_write_guard
  BEFORE INSERT OR UPDATE ON mobile_push_tokens
  FOR EACH ROW EXECUTE FUNCTION reject_write_after_account_deletion();
