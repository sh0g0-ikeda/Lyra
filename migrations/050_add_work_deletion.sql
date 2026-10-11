-- Spec §5/6: durable exact-asset deletion. The graph remains the ownership
-- inventory until every external object has a fenced deletion checkpoint.
ALTER TABLE works ADD COLUMN deletion_started_at timestamptz;
CREATE TABLE work_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','pending_external_action','completed')),
  processing_token uuid,
  lease_expires_at timestamptz,
  blocker_code text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((processing_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX work_deletion_recovery ON work_deletion_requests (COALESCE(next_retry_at,created_at),id)
  WHERE status <> 'completed';
CREATE TABLE work_deletion_resources (
  request_id uuid NOT NULL REFERENCES work_deletion_requests(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('episode','page','entity','job','export')),
  resource_id uuid NOT NULL,
  PRIMARY KEY (request_id,kind,resource_id)
);
CREATE TABLE work_deletion_assets (
  request_id uuid NOT NULL REFERENCES work_deletion_requests(id) ON DELETE RESTRICT,
  s3_key text CHECK (length(s3_key) BETWEEN 1 AND 1024),
  key_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('object','fenced_state')),
  deleted_at timestamptz,
  PRIMARY KEY (request_id,key_hash)
);

CREATE FUNCTION lyra_work_asset_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.key_hash:=encode(sha256(convert_to(NEW.s3_key,'UTF8')),'hex'); RETURN NEW; END $$;
CREATE TRIGGER work_asset_hash BEFORE INSERT ON work_deletion_assets FOR EACH ROW EXECUTE FUNCTION lyra_work_asset_hash();

-- Preserve UUID ownership before ordinary child deletion or skeleton replacement.
-- No content or parent FK: the evidence must outlive the deleted graph.
CREATE TABLE work_resource_ownership (
 kind text NOT NULL CHECK(kind IN ('page','entity')), resource_id uuid NOT NULL, work_id uuid NOT NULL,
 PRIMARY KEY(kind,resource_id,work_id)
);
CREATE INDEX work_resource_ownership_work ON work_resource_ownership(work_id);
INSERT INTO work_resource_ownership SELECT 'entity',id,work_id FROM entities;
INSERT INTO work_resource_ownership SELECT 'page',p.id,c.work_id FROM pages p JOIN episodes e ON e.id=p.episode_id JOIN chapters c ON c.id=e.chapter_id;
CREATE FUNCTION lyra_record_work_resource_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='entities' THEN
  INSERT INTO work_resource_ownership VALUES('entity',NEW.id,NEW.work_id) ON CONFLICT DO NOTHING;
 ELSE
  INSERT INTO work_resource_ownership SELECT 'page',p.id,c.work_id FROM pages p
   JOIN episodes e ON e.id=p.episode_id JOIN chapters c ON c.id=e.chapter_id
   WHERE (TG_TABLE_NAME='pages' AND p.id=NEW.id) OR (TG_TABLE_NAME='episodes' AND e.id=NEW.id)
    OR (TG_TABLE_NAME='chapters' AND c.id=NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_resource_ownership AFTER INSERT OR UPDATE ON entities FOR EACH ROW EXECUTE FUNCTION lyra_record_work_resource_ownership();
CREATE TRIGGER work_resource_ownership AFTER INSERT OR UPDATE ON pages FOR EACH ROW EXECUTE FUNCTION lyra_record_work_resource_ownership();
CREATE TRIGGER work_resource_ownership AFTER UPDATE ON episodes FOR EACH ROW EXECUTE FUNCTION lyra_record_work_resource_ownership();
CREATE TRIGGER work_resource_ownership AFTER UPDATE ON chapters FOR EACH ROW EXECUTE FUNCTION lyra_record_work_resource_ownership();

-- Each owned prefix is enumerated completely before any storage erasure.
-- The cursor survives lost responses and process replacement; deletion remains exact-key.
CREATE TABLE work_deletion_prefixes (
 request_id uuid NOT NULL REFERENCES work_deletion_requests(id) ON DELETE RESTRICT,
 prefix text NOT NULL CHECK(length(prefix) BETWEEN 1 AND 1024),
 key_marker text, version_marker text, scan_complete boolean NOT NULL DEFAULT false,
 PRIMARY KEY(request_id,prefix),
 CHECK ((key_marker IS NULL)=(version_marker IS NULL))
);

CREATE FUNCTION lyra_work_resource_uuid(value text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN value::uuid END
$$;
CREATE FUNCTION lyra_resource_work_id(relation_name text, document jsonb) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE resource uuid; result uuid; parameters jsonb;
BEGIN
  IF relation_name='works' THEN RETURN lyra_work_resource_uuid(document->>'id'); END IF;
  IF relation_name IN ('chapters','entities') THEN RETURN lyra_work_resource_uuid(document->>'work_id'); END IF;
  IF relation_name='episodes' THEN
    SELECT work_id INTO result FROM chapters WHERE id=lyra_work_resource_uuid(document->>'chapter_id');
  ELSIF relation_name IN ('pages','scenes','episode_export_jobs','export_jobs') THEN
    SELECT c.work_id INTO result FROM episodes e JOIN chapters c ON c.id=e.chapter_id
      WHERE e.id=lyra_work_resource_uuid(document->>'episode_id');
  ELSIF relation_name IN ('panels','panel_frames','balloons') THEN
    SELECT c.work_id INTO result FROM pages p JOIN episodes e ON e.id=p.episode_id JOIN chapters c ON c.id=e.chapter_id
      WHERE p.id=lyra_work_resource_uuid(document->>'page_id');
  ELSIF relation_name IN ('reference_sets','entity_states','entity_reference_upload_tokens','state_reference_copy_attempts') THEN
    SELECT work_id INTO result FROM entities WHERE id=lyra_work_resource_uuid(document->>'entity_id');
  ELSIF relation_name='generation_jobs' THEN
    parameters:=document->'params';
    IF document->>'job_type' IN ('entity_generate','entity_import_analysis') THEN
      SELECT work_id INTO result FROM entities WHERE id=lyra_work_resource_uuid(parameters->>'entity_id');
    ELSIF document->>'job_type'='page_generate' THEN
      SELECT c.work_id INTO result FROM pages p JOIN episodes e ON e.id=p.episode_id JOIN chapters c ON c.id=e.chapter_id
        WHERE p.id=lyra_work_resource_uuid(parameters->>'page_id');
    ELSE
      SELECT c.work_id INTO result FROM episodes e JOIN chapters c ON c.id=e.chapter_id
        WHERE e.id=lyra_work_resource_uuid(parameters->>'episode_id');
    END IF;
    -- Server-persisted historical job/quote evidence survives pre-journal child deletion.
    -- Match tenant scope and accept one unambiguous work only.
    IF result IS NULL THEN
      SELECT CASE WHEN count(DISTINCT w.id)=1 THEN (array_agg(DISTINCT w.id))[1] END INTO result
      FROM works w JOIN (
        SELECT lyra_work_resource_uuid(parameters->>'work_id') AS work_id
        UNION SELECT lyra_work_resource_uuid(q.plan->>'workId') FROM generation_quotes q
          WHERE q.accepted_job_id=lyra_work_resource_uuid(document->>'id')
            AND q.user_id=lyra_work_resource_uuid(document->>'user_id')
            AND q.organization_id IS NOT DISTINCT FROM lyra_work_resource_uuid(document->>'organization_id')
        UNION SELECT o.work_id FROM work_resource_ownership o
          WHERE (o.kind='page' AND o.resource_id=lyra_work_resource_uuid(parameters->>'page_id'))
             OR (o.kind='entity' AND o.resource_id=lyra_work_resource_uuid(parameters->>'entity_id'))
      ) evidence ON evidence.work_id=w.id
      WHERE w.organization_id IS NOT DISTINCT FROM lyra_work_resource_uuid(document->>'organization_id')
        AND (w.organization_id IS NOT NULL OR w.user_id=lyra_work_resource_uuid(document->>'user_id'));
    END IF;
    -- Keep the deletion fence after graph teardown, including retained failed-job retries.
    IF result IS NULL THEN
      SELECT r.work_id INTO result FROM work_deletion_resources target JOIN work_deletion_requests r ON r.id=target.request_id
        WHERE target.kind='job' AND target.resource_id=lyra_work_resource_uuid(document->>'id');
    END IF;
  ELSIF relation_name='generation_quotes' THEN
    result:=lyra_work_resource_uuid(document->'plan'->>'workId');
  END IF;
  IF result IS NULL AND relation_name IN ('reference_sets','entity_states','entity_reference_upload_tokens','state_reference_copy_attempts') THEN
    SELECT CASE WHEN count(DISTINCT work_id)=1 THEN (array_agg(DISTINCT work_id))[1] END INTO result FROM (
      SELECT work_id FROM work_resource_ownership WHERE kind='entity' AND resource_id=lyra_work_resource_uuid(document->>'entity_id')
      UNION SELECT request.work_id FROM work_deletion_resources resource JOIN work_deletion_requests request ON request.id=resource.request_id
        WHERE resource.kind='entity' AND resource.resource_id=lyra_work_resource_uuid(document->>'entity_id')
    ) historical;
  END IF;
  RETURN result;
END
$$;

CREATE FUNCTION lyra_work_deletion_claim_allows(target_work uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM work_deletion_requests
    WHERE work_id=target_work AND status='processing'
      AND processing_token=lyra_work_resource_uuid(current_setting('lyra.work_deletion_token',true))
      AND id=lyra_work_resource_uuid(current_setting('lyra.work_deletion_request',true))
      AND lease_expires_at>now()
  )
$$;

CREATE FUNCTION lyra_guard_work_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; previous_document jsonb; target_work uuid; old_work uuid; pending boolean;
BEGIN
  -- Global reference admission precedes the shared-reference query. A deletion
  -- holds the exclusive peer until its manifest commits, closing cross-work races.
  PERFORM pg_advisory_xact_lock_shared(782341902145::bigint);
  document:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target_work:=lyra_resource_work_id(TG_TABLE_NAME,document);
  IF TG_OP='UPDATE' THEN old_work:=lyra_resource_work_id(TG_TABLE_NAME,to_jsonb(OLD)); END IF;
  IF TG_TABLE_NAME='state_reference_copy_attempts' AND TG_OP='UPDATE' AND document->>'scrubbed_at' IS NOT NULL THEN
    target_work:=COALESCE(target_work,old_work);
  END IF;
  IF TG_OP<>'DELETE' AND EXISTS (
    SELECT 1 FROM work_deletion_assets a JOIN work_deletion_requests r ON r.id=a.request_id
    WHERE r.work_id IS DISTINCT FROM target_work AND (position(a.s3_key in document::text)>0
      OR (a.s3_key IS NULL AND EXISTS (SELECT 1 FROM jsonb_path_query(document,'$.**') scalar(value)
        WHERE jsonb_typeof(value)='string' AND encode(sha256(convert_to(value#>>'{}','UTF8')),'hex')=a.key_hash)))
  ) THEN RAISE EXCEPTION 'Work asset is pending deletion' USING ERRCODE='23514',CONSTRAINT='work_deletion_write_guard'; END IF;

  IF TG_OP='UPDATE' THEN old_work:=lyra_resource_work_id(TG_TABLE_NAME,to_jsonb(OLD)); END IF;
  -- A child cannot escape the deletion fence by moving to another parent.
  FOR target_work IN SELECT DISTINCT id FROM unnest(ARRAY[target_work,old_work]) id WHERE id IS NOT NULL ORDER BY id LOOP
    SELECT deletion_started_at IS NOT NULL INTO pending FROM works WHERE id=target_work FOR SHARE NOWAIT;
    IF pending IS TRUE OR EXISTS (SELECT 1 FROM work_deletion_requests WHERE work_id=target_work) THEN
      IF NOT lyra_work_deletion_claim_allows(target_work) THEN
        -- Initial freeze is the only ordinary mutation of a requested work.
        IF NOT (TG_TABLE_NAME='works' AND TG_OP='UPDATE'
          AND (to_jsonb(OLD)->>'deletion_started_at') IS NULL AND (to_jsonb(NEW)->>'deletion_started_at') IS NOT NULL
          AND EXISTS (SELECT 1 FROM work_deletion_requests r WHERE r.work_id=target_work AND r.status='pending')) THEN
          RAISE EXCEPTION 'Work deletion is pending' USING ERRCODE='23514',CONSTRAINT='work_deletion_write_guard';
        END IF;
      END IF;
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['works','chapters','episodes','scenes','entities','reference_sets','entity_states',
    'pages','panels','panel_frames','balloons','generation_jobs','episode_export_jobs','export_jobs','generation_quotes',
    'entity_reference_upload_tokens','state_reference_copy_attempts']
  LOOP
    IF to_regclass(relation_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE TRIGGER work_deletion_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION lyra_guard_work_deletion()',relation_name);
  END LOOP;
END
$$;


-- Work storage operations cover synchronous S3 calls that precede their DB write.
-- An ambiguous response retains an unresolved intent and blocks deletion.
CREATE TABLE work_storage_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'executing' CHECK(status IN ('executing','settled','unresolved')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_storage_operations_unsettled ON work_storage_operations(work_id) WHERE status<>'settled';

DO $$
DECLARE constraint_row record; definition text;
BEGIN
 FOR constraint_row IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
   WHERE conrelid='state_reference_copy_attempts'::regclass AND contype='c'
     AND pg_get_constraintdef(oid) LIKE '%account_deletion%'
 LOOP
  definition:=constraint_row.definition;
  definition:=replace(definition,'ARRAY[''unconfirmed_recovery''::text, ''account_deletion''::text]','ARRAY[''unconfirmed_recovery''::text, ''account_deletion''::text, ''work_deletion''::text]');
  definition:=replace(definition,'fencing_reason = ''account_deletion''::text','fencing_reason = ANY (ARRAY[''account_deletion''::text, ''work_deletion''::text])');
  definition:=replace(definition,'fencing_reason <> ''account_deletion''::text','fencing_reason <> ALL (ARRAY[''account_deletion''::text, ''work_deletion''::text])');
  EXECUTE format('ALTER TABLE state_reference_copy_attempts DROP CONSTRAINT %I',constraint_row.conname);
  EXECUTE format('ALTER TABLE state_reference_copy_attempts ADD CONSTRAINT %I %s',constraint_row.conname,definition);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION lyra_guard_state_copy_v2_journal() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
    OR (OLD.state = 'confirmed' AND NEW.state = 'fencing' AND NEW.fencing_reason IN ('account_deletion','work_deletion'))
    OR (OLD.state = 'fencing' AND NEW.state = 'effects_fenced')) THEN
    RAISE EXCEPTION 'State reference transition is invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW.scrubbed_at IS DISTINCT FROM OLD.scrubbed_at THEN
    IF OLD.state <> 'effects_fenced' OR NEW.state <> 'effects_fenced'
      OR NOT (
        (OLD.organization_id IS NULL AND OLD.owner_user_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM users WHERE id=OLD.owner_user_id AND account_deletion_started_at IS NOT NULL))
        OR EXISTS (SELECT 1 FROM work_deletion_resources target JOIN work_deletion_requests r ON r.id=target.request_id
          WHERE target.kind='entity' AND target.resource_id=OLD.entity_id
            AND r.organization_id IS NOT DISTINCT FROM OLD.organization_id
            AND lyra_work_deletion_claim_allows(r.work_id)
            AND OLD.marker_receipt IS NOT NULL AND OLD.history_erased_at IS NOT NULL)
      ) THEN
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
  IF NEW.fencing_reason='work_deletion' AND (NEW.state='fencing' OR (OLD.state='fencing' AND NEW.state='effects_fenced')) THEN
    IF NOT EXISTS (
      SELECT 1 FROM work_deletion_requests r JOIN work_deletion_resources target ON target.request_id=r.id
      WHERE r.status='processing' AND r.processing_token=NEW.deletion_processing_token AND r.lease_expires_at>now()
        AND target.kind='entity' AND target.resource_id=NEW.entity_id
        AND r.organization_id IS NOT DISTINCT FROM NEW.organization_id
    ) THEN RAISE EXCEPTION 'State reference work deletion claim is stale' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
