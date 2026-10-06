-- Enterprise workspace foundation.
-- Keep personal ownership untouched: existing users, works, credits, and jobs
-- continue to use user_id. organization_id is opt-in for business workspaces.

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'business',
  name text NOT NULL,
  legal_name text,
  status text NOT NULL DEFAULT 'active',
  plan_key text NOT NULL DEFAULT 'enterprise_a',
  billing_email text,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT organizations_type_check CHECK (type IN ('business', 'internal')),
  CONSTRAINT organizations_status_check CHECK (status IN ('active', 'trialing', 'past_due', 'suspended', 'canceled')),
  CONSTRAINT organizations_plan_key_check CHECK (plan_key IN ('enterprise_a', 'enterprise_b', 'enterprise_c')),
  CONSTRAINT organizations_name_length_check CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  CONSTRAINT organizations_legal_name_length_check CHECK (legal_name IS NULL OR char_length(trim(legal_name)) BETWEEN 1 AND 200),
  CONSTRAINT organizations_billing_email_length_check CHECK (billing_email IS NULL OR char_length(trim(billing_email)) BETWEEN 3 AND 320)
);

CREATE TABLE IF NOT EXISTS organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id),
  CONSTRAINT organization_members_role_check CHECK (role IN ('owner', 'admin', 'billing', 'editor', 'creator', 'viewer')),
  CONSTRAINT organization_members_status_check CHECK (status IN ('invited', 'active', 'suspended', 'removed'))
);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_invitations_role_check CHECK (role IN ('owner', 'admin', 'billing', 'editor', 'creator', 'viewer')),
  CONSTRAINT organization_invitations_status_check CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  CONSTRAINT organization_invitations_email_length_check CHECK (char_length(trim(email)) BETWEEN 3 AND 320)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_invitations_pending_email
  ON organization_invitations (organization_id, lower(email))
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS organization_credit_balances (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  monthly_credits integer NOT NULL DEFAULT 0,
  purchased_credits integer NOT NULL DEFAULT 0,
  monthly_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_credit_balances_nonnegative_check CHECK (monthly_credits >= 0 AND purchased_credits >= 0)
);

CREATE TABLE IF NOT EXISTS organization_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  work_id uuid REFERENCES works(id) ON DELETE SET NULL,
  generation_job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  credit_amount integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_usage_events_credit_nonnegative_check CHECK (credit_amount >= 0),
  CONSTRAINT organization_usage_events_type_length_check CHECK (char_length(trim(event_type)) BETWEEN 1 AND 80)
);

CREATE TABLE IF NOT EXISTS organization_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_audit_logs_action_length_check CHECK (char_length(trim(action)) BETWEEN 1 AND 100),
  CONSTRAINT organization_audit_logs_target_type_length_check CHECK (char_length(trim(target_type)) BETWEEN 1 AND 80)
);

ALTER TABLE works ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

-- Organization billing and credit events are scoped by organization_id. Personal
-- rows still carry user_id, but enterprise webhook grants may not have an actor.
ALTER TABLE credit_ledger ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE payment_records ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_scope_check,
  ADD CONSTRAINT credit_ledger_scope_check CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL);

ALTER TABLE payment_records
  DROP CONSTRAINT IF EXISTS payment_records_scope_check,
  ADD CONSTRAINT payment_records_scope_check CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL);

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_scope_check,
  ADD CONSTRAINT subscriptions_scope_check CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL);
