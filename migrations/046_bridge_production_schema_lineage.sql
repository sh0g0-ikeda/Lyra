-- Forward-only compatibility prepass. The migration runner executes this early
-- ONLY after strict lineage/data validation and explicit writer-quiescence opt-in.
-- Historical applied filenames remain untouched. This is a no-op on fresh Lyra.
DO $$
DECLARE
  had_sources BOOLEAN;
  had_purpose BOOLEAN;
  had_continuity BOOLEAN;
  user_fk RECORD;
BEGIN
  IF current_setting('lyra.production_lineage_bridge', TRUE) IS DISTINCT FROM 'validated-production-v1' THEN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=CURRENT_SCHEMA() AND c.relname='export_jobs' AND c.relkind='r') THEN
      RAISE EXCEPTION 'Production lineage requires the validated compatibility prepass';
    END IF;
    RETURN;
  END IF;

  -- Rename the same relations; never copy/delete export IDs, snapshots or outbox.
  ALTER TABLE export_jobs RENAME TO episode_export_jobs;
  ALTER TABLE export_job_outbox RENAME TO episode_export_job_outbox;

  -- Old trigger ON CONFLICT targets become invalid when migration039 installs
  -- retry-aware uniqueness. New services settle terminal notifications explicitly.
  DROP TRIGGER IF EXISTS generation_jobs_enqueue_mobile_push_notification ON generation_jobs;
  DROP TRIGGER IF EXISTS generation_job_late_consume_refund ON credit_ledger;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=CURRENT_SCHEMA()
    AND table_name='generation_jobs' AND column_name='cancel_requested_by_user_id') THEN
    ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS cancel_requested_by UUID REFERENCES users(id) ON DELETE SET NULL;
    UPDATE generation_jobs SET cancel_requested_by=cancel_requested_by_user_id
      WHERE cancel_requested_by IS NULL AND cancel_requested_by_user_id IS NOT NULL;
  END IF;
  ALTER TABLE generation_jobs
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancel_requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS commit_started_at TIMESTAMPTZ;
  ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_status_check;
  UPDATE generation_jobs SET status='cancelled' WHERE status='canceled';
  ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
    CHECK (status IN ('queued','processing','completed','failed','cancelled')) NOT VALID;
  ALTER TABLE generation_jobs VALIDATE CONSTRAINT generation_jobs_status_check;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='generation_jobs'::regclass AND conname='generation_jobs_cancel_request_metadata_check') THEN
    ALTER TABLE generation_jobs RENAME CONSTRAINT generation_jobs_cancel_request_metadata_check
      TO legacy_production_generation_cancel_request_metadata_check;
  END IF;

  ALTER TABLE mobile_push_notification_outbox ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
  UPDATE mobile_push_notification_outbox o SET organization_id=j.organization_id
    FROM generation_jobs j WHERE j.id=o.generation_job_id AND o.organization_id IS NULL;

  -- Billing evidence is retained when a user is anonymized, never cascaded away.
  FOR user_fk IN SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid='mobile_store_purchases'::regclass AND c.contype='f' AND c.confrelid='users'::regclass AND c.confdeltype='c'
  LOOP
    EXECUTE format('ALTER TABLE mobile_store_purchases DROP CONSTRAINT %I',user_fk.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='mobile_store_purchases'::regclass AND c.contype='f' AND c.confrelid='users'::regclass AND c.confdeltype='r') THEN
    ALTER TABLE mobile_store_purchases ADD CONSTRAINT mobile_store_purchases_user_id_restrict_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT NOT VALID;
    ALTER TABLE mobile_store_purchases VALIDATE CONSTRAINT mobile_store_purchases_user_id_restrict_fkey;
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=CURRENT_SCHEMA() AND table_name='pages' AND column_name='story_source_scene_ids'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=CURRENT_SCHEMA() AND table_name='pages' AND column_name='story_page_purpose'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=CURRENT_SCHEMA() AND table_name='pages' AND column_name='story_continuity_note')
    INTO had_sources,had_purpose,had_continuity;
  ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS story_source_scene_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    ADD COLUMN IF NOT EXISTS story_page_purpose TEXT,
    ADD COLUMN IF NOT EXISTS story_continuity_note TEXT;
  IF NOT had_sources THEN
    UPDATE pages SET story_source_scene_ids=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(layout_config->'story_source_scene_ids')='array' THEN layout_config->'story_source_scene_ids' ELSE '[]'::jsonb END) AS source(value));
  END IF;
  IF NOT had_purpose THEN UPDATE pages SET story_page_purpose=layout_config->>'story_page_purpose'; END IF;
  IF NOT had_continuity THEN UPDATE pages SET story_continuity_note=layout_config->>'story_continuity_note'; END IF;
  UPDATE pages SET layout_config=COALESCE(layout_config,'{}'::jsonb)||jsonb_build_object(
    'story_source_scene_ids',to_jsonb(story_source_scene_ids),
    'story_page_purpose',story_page_purpose,
    'story_continuity_note',story_continuity_note);

  -- Only existing recorded deletion events determine timestamps. The application
  -- computes the keyed identity digest separately within this SAME transaction.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS account_deletion_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS account_deleted_at TIMESTAMPTZ;
  ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS identity_key TEXT;
  UPDATE users u SET account_deletion_started_at=COALESCE(u.account_deletion_started_at,
      r.processing_started_at,r.data_anonymized_at,r.identity_disabled_at,r.created_at),
    account_deleted_at=CASE WHEN r.status='completed' THEN COALESCE(u.account_deleted_at,r.completed_at,r.identity_deleted_at,r.data_anonymized_at,r.updated_at)
      ELSE u.account_deleted_at END
    FROM account_deletion_requests r WHERE r.user_id=u.id AND r.status IN ('processing','pending_external_action','completed');
END
$$;
