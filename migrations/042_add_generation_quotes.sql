-- New opaque quotes are server-owned. This migration alone enables no API or dispatch.
CREATE TABLE generation_quotes (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('page_generate', 'page_regenerate', 'entity_preview', 'entity_state_preview', 'entity_import_analysis')),
  target_id UUID NOT NULL,
  request JSONB NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  plan JSONB NOT NULL CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 2097152),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_job_id UUID UNIQUE REFERENCES generation_jobs(id) ON DELETE CASCADE,
  request_key UUID,
  accepted_at TIMESTAMPTZ,
  dispatch_state TEXT NOT NULL DEFAULT 'unaccepted' CHECK (dispatch_state IN ('unaccepted', 'pending', 'dispatching', 'dispatched')),
  dispatch_lease_token UUID,
  dispatch_lease_until TIMESTAMPTZ,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
  dispatch_next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT generation_quote_acceptance_consistent CHECK (
    (accepted_job_id IS NULL AND request_key IS NULL AND accepted_at IS NULL AND dispatch_state = 'unaccepted')
    OR (accepted_job_id IS NOT NULL AND request_key IS NOT NULL AND accepted_at IS NOT NULL AND dispatch_state <> 'unaccepted')
  ),
  CONSTRAINT generation_quote_dispatch_lease_consistent CHECK (
    (dispatch_state = 'dispatching' AND dispatch_lease_token IS NOT NULL AND dispatch_lease_until IS NOT NULL)
    OR (dispatch_state <> 'dispatching' AND dispatch_lease_token IS NULL AND dispatch_lease_until IS NULL)
  )
);
-- A partial index permits multiple unaccepted quotes, but one request key per scope.
CREATE UNIQUE INDEX generation_quotes_accepted_request_key
  ON generation_quotes (user_id, organization_id, request_key) NULLS NOT DISTINCT
  WHERE request_key IS NOT NULL;
CREATE INDEX generation_quotes_pending_dispatch ON generation_quotes (dispatch_next_attempt_at)
  WHERE dispatch_state IN ('pending', 'dispatching');
CREATE INDEX generation_quotes_unaccepted_expiry ON generation_quotes (expires_at)
  WHERE accepted_job_id IS NULL;
