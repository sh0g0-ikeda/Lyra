-- lyra:migration no-transaction
-- Durable orchestration for opt-in missing-only bulk generation. The feature
-- flag remains the admission authority; adding these tables enables no route.
CREATE TABLE IF NOT EXISTS generation_batches (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('character_references', 'pages')),
  status TEXT NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted','running','paused','needs_review','completed','cancelled')),
  selection TEXT NOT NULL CHECK (selection = 'missing_only'),
  render_style TEXT NOT NULL CHECK (render_style IN ('color','monochrome')),
  image_model TEXT NOT NULL,
  pricing_version TEXT NOT NULL,
  maximum_credits INTEGER NOT NULL CHECK (maximum_credits >= 0),
  auto_confirm BOOLEAN NOT NULL DEFAULT FALSE,
  approved_plan JSONB NOT NULL CHECK (jsonb_typeof(approved_plan) = 'object' AND octet_length(approved_plan::text) <= 2097152),
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers) = 'array'),
  expires_at TIMESTAMPTZ NOT NULL,
  request_key UUID,
  accepted_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT generation_batch_kind_scope CHECK (
    (kind='pages' AND episode_id IS NOT NULL) OR
    (kind='character_references' AND episode_id IS NULL)
  ),
  CONSTRAINT generation_batch_acceptance_consistent CHECK (
    (status='quoted' AND request_key IS NULL AND accepted_at IS NULL AND auto_confirm=FALSE)
    OR (status='cancelled' AND request_key IS NULL AND accepted_at IS NULL AND auto_confirm=FALSE)
    OR (status<>'quoted' AND request_key IS NOT NULL AND accepted_at IS NOT NULL AND auto_confirm=TRUE)
  )
);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS generation_batches_request_key
  ON generation_batches (user_id, organization_id, request_key) NULLS NOT DISTINCT
  WHERE request_key IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS generation_batches_scope_created
  ON generation_batches (user_id, organization_id, work_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS generation_batches_reconcile
  ON generation_batches (updated_at)
  WHERE status IN ('running','paused');

CREATE TABLE IF NOT EXISTS generation_batch_items (
  id UUID PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES generation_batches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('entity_base','entity_state','page')),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  target_id UUID NOT NULL,
  entity_id UUID,
  depends_on_item_id UUID REFERENCES generation_batch_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','confirming','completed','skipped','failed','cancelled','needs_review')),
  approved_request JSONB NOT NULL CHECK (jsonb_typeof(approved_request) = 'object'),
  approved_input JSONB NOT NULL CHECK (jsonb_typeof(approved_input) = 'object' AND octet_length(approved_input::text) <= 2097152),
  input_revision TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('entity_preview','entity_state_preview','page_generate')),
  image_model TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  render_style TEXT,
  amount_credits INTEGER NOT NULL CHECK (amount_credits >= 0),
  pricing_version TEXT NOT NULL,
  child_quote_id UUID REFERENCES generation_quotes(id) ON DELETE SET NULL,
  job_id UUID REFERENCES generation_jobs(id) ON DELETE SET NULL,
  confirmation JSONB,
  blocker JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, position),
  UNIQUE (batch_id, kind, target_id),
  CONSTRAINT generation_batch_item_shape CHECK (
    (kind='entity_base' AND entity_id=target_id AND render_style IS NULL)
    OR (kind='entity_state' AND entity_id IS NOT NULL AND render_style IS NULL)
    OR (kind='page' AND entity_id IS NULL AND render_style IN ('color','monochrome'))
  )
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS generation_batch_items_next
  ON generation_batch_items (batch_id, position)
  WHERE status IN ('pending','active','confirming');
CREATE INDEX CONCURRENTLY IF NOT EXISTS generation_batch_items_job
  ON generation_batch_items (job_id) WHERE job_id IS NOT NULL;
