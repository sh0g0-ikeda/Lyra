ALTER TABLE payment_records
  ADD COLUMN granted_credits integer,
  ADD COLUMN credit_bucket text,
  ADD COLUMN grant_expires_at timestamptz,
  ADD CONSTRAINT payment_records_credit_grant_check CHECK (
    (granted_credits IS NULL AND credit_bucket IS NULL AND grant_expires_at IS NULL)
    OR (granted_credits = 0 AND credit_bucket IS NULL AND grant_expires_at IS NULL)
    OR (
      granted_credits > 0
      AND credit_bucket IN ('monthly', 'purchased')
    )
  );

CREATE TABLE stripe_payment_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_record_id uuid NOT NULL UNIQUE REFERENCES payment_records(id) ON DELETE RESTRICT,
  stripe_payment_intent_id text NOT NULL UNIQUE,
  stripe_charge_id text UNIQUE,
  currency text NOT NULL,
  credit_bucket text NOT NULL,
  granted_credits integer NOT NULL,
  grant_expires_at timestamptz,
  observed_refunded_amount_jpy integer NOT NULL DEFAULT 0,
  target_reversal_credits integer NOT NULL DEFAULT 0,
  reversed_credits integer NOT NULL DEFAULT 0,
  unrecovered_credits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT stripe_payment_recoveries_currency_check CHECK (currency = 'jpy'),
  CONSTRAINT stripe_payment_recoveries_credit_bucket_check CHECK (credit_bucket IN ('monthly', 'purchased')),
  CONSTRAINT stripe_payment_recoveries_monthly_period_check CHECK (
    credit_bucket = 'purchased' OR grant_expires_at IS NOT NULL
  ),
  CONSTRAINT stripe_payment_recoveries_credit_totals_check CHECK (
    granted_credits > 0
    AND target_reversal_credits BETWEEN 0 AND granted_credits
    AND reversed_credits BETWEEN 0 AND target_reversal_credits
    AND unrecovered_credits = target_reversal_credits - reversed_credits
  ),
  CONSTRAINT stripe_payment_recoveries_refund_amount_check CHECK (observed_refunded_amount_jpy >= 0)
);

CREATE TABLE stripe_unresolved_payment_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_record_id uuid NOT NULL REFERENCES payment_records(id) ON DELETE RESTRICT,
  stripe_payment_intent_id text NOT NULL,
  stripe_charge_id text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('refund', 'dispute')),
  provider_object_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'open', 'won', 'lost')),
  amount_jpy integer NOT NULL CHECK (amount_jpy >= 0),
  observed_refunded_amount_jpy integer NOT NULL CHECK (observed_refunded_amount_jpy >= 0),
  last_stripe_event_id text NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (provider_type, provider_object_id),
  UNIQUE (last_stripe_event_id)
);

CREATE INDEX idx_stripe_unresolved_payment_adjustments_payment
  ON stripe_unresolved_payment_adjustments (payment_record_id, resolved_at);

CREATE TABLE stripe_payment_adjustment_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_id uuid NOT NULL REFERENCES stripe_payment_recoveries(id) ON DELETE RESTRICT,
  provider_type text NOT NULL CHECK (provider_type IN ('refund', 'dispute')),
  provider_object_id text NOT NULL,
  amount_jpy integer NOT NULL CHECK (amount_jpy >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'open', 'won', 'lost')),
  last_stripe_event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (provider_type, provider_object_id),
  UNIQUE (last_stripe_event_id)
);

CREATE INDEX idx_stripe_payment_adjustment_objects_recovery_status
  ON stripe_payment_adjustment_objects (recovery_id, status);

ALTER TABLE credit_ledger
  ADD COLUMN stripe_payment_recovery_id uuid REFERENCES stripe_payment_recoveries(id) ON DELETE RESTRICT;

CREATE INDEX idx_credit_ledger_stripe_payment_recovery
  ON credit_ledger (stripe_payment_recovery_id, created_at)
  WHERE stripe_payment_recovery_id IS NOT NULL;
