-- Dormant v2 journal. Applying this migration does not enable storage writers.
-- No foreign keys: deletion of a job, entity, work, or result must never remove
-- the only evidence of a possibly outstanding write. v1 history stays separate.
CREATE FUNCTION lyra_valid_state_copy_v2_storage_revision(value JSONB) RETURNS BOOLEAN
  LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'eTag') = 'string'
    AND value->>'eTag' ~ '^"[!#-~]{1,254}"$'
    AND (value - ARRAY['eTag','versionId']) = '{}'::jsonb
    AND (NOT (value ? 'versionId') OR (jsonb_typeof(value->'versionId') = 'string'
      AND char_length(value->>'versionId') BETWEEN 1 AND 1024
      AND value->>'versionId' !~ '[[:cntrl:] ]')), FALSE)
$$;

CREATE TABLE state_reference_copy_attempts (
  attempt_token UUID PRIMARY KEY,
  protocol TEXT NOT NULL CHECK (protocol = 'state-reference-fenced-v2'),
  s3_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('unresolved', 'confirmed', 'fencing', 'effects_fenced')),
  actor_user_id UUID,
  owner_user_id UUID,
  organization_id UUID,
  entity_id UUID,
  state_id UUID,
  job_id UUID,
  candidate_ref_id TEXT,
  candidate_s3_key TEXT,
  expected_state_revision TEXT,
  descriptor JSONB,
  digest TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  source_revision JSONB,
  image_receipt JSONB,
  marker_receipt JSONB,
  dispatch_started_at TIMESTAMPTZ,
  fencing_reason TEXT CHECK (fencing_reason IN ('unconfirmed_recovery', 'account_deletion')),
  deletion_processing_token UUID,
  history_erased_at TIMESTAMPTZ,
  scrubbed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (s3_key ~ ('^state-reference-v2/' || attempt_token::text || '/[0-9a-f]{64}\.(png|jpeg|webp)$')),
  CONSTRAINT state_copy_v2_scope_shape CHECK (
    (scrubbed_at IS NULL AND actor_user_id IS NOT NULL AND owner_user_id = actor_user_id
      AND owner_user_id IS NOT NULL AND entity_id IS NOT NULL AND state_id IS NOT NULL AND job_id IS NOT NULL
      AND candidate_ref_id IS NOT NULL AND char_length(candidate_ref_id) BETWEEN 1 AND 200
      AND candidate_s3_key IS NOT NULL AND char_length(candidate_s3_key) BETWEEN 1 AND 1024
      AND expected_state_revision IS NOT NULL AND char_length(expected_state_revision) BETWEEN 1 AND 64
      AND digest IS NOT NULL AND digest ~ '^[0-9a-f]{64}$'
      AND mime_type IS NOT NULL AND mime_type IN ('image/png','image/jpeg','image/webp')
      AND size_bytes IS NOT NULL AND size_bytes BETWEEN 1 AND 5242880
      AND lyra_valid_state_copy_v2_storage_revision(source_revision)
      AND COALESCE(jsonb_typeof(descriptor) = 'object'
        AND descriptor->>'ref_id' = candidate_ref_id AND descriptor->>'s3_key' = s3_key
        AND descriptor->>'storage_owner_user_id' = owner_user_id::text
        AND char_length(descriptor->>'base_ref_id') > 0
        AND char_length(descriptor->>'image_model') > 0
        AND char_length(descriptor->>'input_fingerprint') > 0
        AND char_length(descriptor->>'created_at') > 0, FALSE))
    OR (scrubbed_at IS NOT NULL AND state = 'effects_fenced'
      AND actor_user_id IS NULL AND owner_user_id IS NULL AND organization_id IS NULL
      AND entity_id IS NULL AND state_id IS NULL AND job_id IS NULL
      AND candidate_ref_id IS NULL AND candidate_s3_key IS NULL AND expected_state_revision IS NULL
      AND descriptor IS NULL AND digest IS NULL AND mime_type IS NULL AND size_bytes IS NULL
      AND source_revision IS NULL AND image_receipt IS NULL AND deletion_processing_token IS NULL)
  ),
  CONSTRAINT state_copy_v2_image_receipt CHECK (image_receipt IS NULL OR COALESCE(
    jsonb_typeof(image_receipt) = 'object' AND image_receipt @> jsonb_build_object(
      'kind','image','protocol',protocol,'attemptToken',attempt_token::text,'s3Key',s3_key,
      'digest',digest,'mimeType',mime_type,'sizeBytes',size_bytes)
      AND lyra_valid_state_copy_v2_storage_revision(image_receipt - ARRAY[
        'kind','protocol','attemptToken','s3Key','digest','mimeType','sizeBytes']), FALSE)),
  CONSTRAINT state_copy_v2_marker_receipt CHECK (marker_receipt IS NULL OR COALESCE(
    jsonb_typeof(marker_receipt) = 'object' AND marker_receipt @> jsonb_build_object(
      'kind','marker','protocol',protocol,'attemptToken',attempt_token::text,'s3Key',s3_key,'historyErased',true)
      AND lyra_valid_state_copy_v2_storage_revision(marker_receipt - ARRAY[
        'kind','protocol','attemptToken','s3Key','historyErased']), FALSE)),
  CONSTRAINT state_copy_v2_state_evidence CHECK (
    (state = 'unresolved' AND image_receipt IS NULL AND marker_receipt IS NULL
      AND fencing_reason IS NULL AND history_erased_at IS NULL)
    OR (state = 'confirmed' AND image_receipt IS NOT NULL AND dispatch_started_at IS NOT NULL
      AND marker_receipt IS NULL AND fencing_reason IS NULL AND history_erased_at IS NULL)
    OR (state = 'fencing' AND fencing_reason IS NOT NULL AND marker_receipt IS NULL AND history_erased_at IS NULL)
    OR (state = 'effects_fenced' AND marker_receipt IS NOT NULL AND history_erased_at IS NOT NULL)
  ),
  CHECK (deletion_processing_token IS NULL OR fencing_reason = 'account_deletion'),
  CHECK (state <> 'fencing' OR fencing_reason <> 'account_deletion' OR deletion_processing_token IS NOT NULL)
);

-- This is a new, empty table, so transactional index creation takes no lock on
-- existing application data. Use ordinary transactional indexes for this new table.
CREATE UNIQUE INDEX state_copy_v2_active_candidate ON state_reference_copy_attempts (job_id, candidate_ref_id)
  WHERE state <> 'effects_fenced';
-- Terminal unscrubbed rows still protect their originating job from TTL pruning.
CREATE INDEX state_copy_v2_retained_job ON state_reference_copy_attempts (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX state_copy_v2_personal_owner ON state_reference_copy_attempts (owner_user_id, created_at, attempt_token)
  WHERE organization_id IS NULL AND scrubbed_at IS NULL;
CREATE INDEX state_copy_v2_pending_state ON state_reference_copy_attempts (entity_id, state_id)
  WHERE state IN ('unresolved', 'fencing');

CREATE FUNCTION lyra_guard_state_copy_v2_journal() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE active_user BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'State reference fencing evidence must be retained' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'unresolved' OR NEW.scrubbed_at IS NOT NULL OR NEW.dispatch_started_at IS NOT NULL THEN
      RAISE EXCEPTION 'State reference admission must start unresolved' USING ERRCODE = '23514';
    END IF;
    SELECT account_deletion_started_at IS NULL AND account_deleted_at IS NULL INTO active_user
      FROM users WHERE id = NEW.actor_user_id FOR UPDATE;
    IF active_user IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Account is unavailable for state reference admission' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.attempt_token,NEW.protocol,NEW.s3_key,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.attempt_token,OLD.protocol,OLD.s3_key,OLD.created_at)
    OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at)
    OR (OLD.history_erased_at IS NOT NULL AND NEW.history_erased_at IS DISTINCT FROM OLD.history_erased_at)
    OR (OLD.marker_receipt IS NOT NULL AND NEW.marker_receipt IS DISTINCT FROM OLD.marker_receipt)
    OR (OLD.image_receipt IS NOT NULL AND NEW.image_receipt IS DISTINCT FROM OLD.image_receipt AND NEW.scrubbed_at IS NULL)
    OR (OLD.scrubbed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'State reference evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW.state = OLD.state
    OR (OLD.state = 'unresolved' AND NEW.state IN ('confirmed','fencing'))
    OR (OLD.state = 'confirmed' AND NEW.state = 'fencing' AND NEW.fencing_reason = 'account_deletion')
    OR (OLD.state = 'fencing' AND NEW.state = 'effects_fenced')) THEN
    RAISE EXCEPTION 'State reference transition is invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW.scrubbed_at IS DISTINCT FROM OLD.scrubbed_at THEN
    IF OLD.state <> 'effects_fenced' OR NEW.state <> 'effects_fenced'
      OR OLD.organization_id IS NOT NULL OR OLD.owner_user_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM users WHERE id=OLD.owner_user_id AND account_deletion_started_at IS NOT NULL) THEN
      RAISE EXCEPTION 'State reference evidence is not ready for personal scrubbing' USING ERRCODE = '23514';
    END IF;
  ELSIF ROW(NEW.actor_user_id,NEW.owner_user_id,NEW.organization_id,NEW.entity_id,NEW.state_id,NEW.job_id,
      NEW.candidate_ref_id,NEW.candidate_s3_key,NEW.expected_state_revision,NEW.descriptor,
      NEW.digest,NEW.mime_type,NEW.size_bytes,NEW.source_revision)
    IS DISTINCT FROM ROW(OLD.actor_user_id,OLD.owner_user_id,OLD.organization_id,OLD.entity_id,OLD.state_id,OLD.job_id,
      OLD.candidate_ref_id,OLD.candidate_s3_key,OLD.expected_state_revision,OLD.descriptor,
      OLD.digest,OLD.mime_type,OLD.size_bytes,OLD.source_revision) THEN
    RAISE EXCEPTION 'State reference admitted scope is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.fencing_reason = 'account_deletion'
    AND (NEW.state = 'fencing' OR (OLD.state = 'fencing' AND NEW.state = 'effects_fenced')) THEN
    IF NEW.organization_id IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM account_deletion_requests requests INNER JOIN users ON users.id=requests.user_id
      WHERE requests.user_id=NEW.owner_user_id AND requests.status='processing'
        AND requests.processing_token=NEW.deletion_processing_token AND users.account_deletion_started_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'State reference deletion claim is stale' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER state_copy_v2_guard BEFORE INSERT OR UPDATE OR DELETE ON state_reference_copy_attempts
  FOR EACH ROW EXECUTE FUNCTION lyra_guard_state_copy_v2_journal();
