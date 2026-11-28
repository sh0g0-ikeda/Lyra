-- Spec §2/§5: additive idempotency and Web editor entry metadata.
CREATE TABLE work_creation_metadata (
  work_id uuid PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('series','one_shot')),
  entry_chapter_id uuid REFERENCES chapters(id) ON DELETE SET NULL,
  entry_episode_id uuid REFERENCES episodes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (actor_user_id, organization_id, request_id)
);
CREATE INDEX idx_work_creation_metadata_scope ON work_creation_metadata (organization_id, work_id);
