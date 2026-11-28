-- Durable idempotency survives work deletion while metadata remains work-owned.
CREATE TABLE work_bootstrap_request_ledger (
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  requested_title text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('series','one_shot')),
  work_id uuid REFERENCES works(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (actor_user_id, organization_id, request_id)
);
