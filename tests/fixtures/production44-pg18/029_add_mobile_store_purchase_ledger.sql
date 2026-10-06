-- lyra:migration no-transaction
-- StoreKit JWS values and Google Play purchase tokens must be converted to
-- HMAC-SHA256 base64url keys before persistence. Raw provider evidence is not
-- part of this schema.

CREATE TABLE IF NOT EXISTS mobile_store_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  store text NOT NULL CHECK (store IN ('apple', 'google')),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  external_purchase_key text NOT NULL,
  product_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('subscription', 'credit_pack')),
  plan_code text,
  credit_package_code text,
  state text NOT NULL CHECK (state IN ('pending', 'active', 'cancelled', 'expired', 'refunded', 'revoked', 'failed')),
  transaction_key text,
  expires_at timestamptz,
  auto_renew_enabled boolean,
  granted_credits integer NOT NULL DEFAULT 0 CHECK (granted_credits >= 0),
  reversed_credits integer NOT NULL DEFAULT 0 CHECK (reversed_credits >= 0),
  last_observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (store, external_purchase_key),
  CONSTRAINT mobile_store_purchases_external_key_shape_check
    CHECK (char_length(external_purchase_key) = 43),
  CONSTRAINT mobile_store_purchases_transaction_key_shape_check
    CHECK (transaction_key IS NULL OR char_length(transaction_key) = 43),
  CONSTRAINT mobile_store_purchases_product_id_length_check
    CHECK (char_length(product_id) BETWEEN 1 AND 255),
  CONSTRAINT mobile_store_purchases_product_mapping_check
    CHECK (
      (
        kind = 'subscription'
        AND plan_code IS NOT NULL
        AND plan_code IN ('standard', 'premium')
        AND credit_package_code IS NULL
      )
      OR (
        kind = 'credit_pack'
        AND plan_code IS NULL
        AND credit_package_code IS NOT NULL
        AND credit_package_code IN ('credits_200', 'credits_1000', 'credits_3000')
      )
    ),
  CONSTRAINT mobile_store_purchases_credit_totals_check
    CHECK (reversed_credits <= granted_credits)
);

DROP INDEX CONCURRENTLY IF EXISTS idx_mobile_store_purchases_user_state;
CREATE INDEX CONCURRENTLY idx_mobile_store_purchases_user_state
  ON mobile_store_purchases (user_id, state, updated_at DESC);

DROP INDEX CONCURRENTLY IF EXISTS idx_mobile_store_purchases_transaction;
CREATE INDEX CONCURRENTLY idx_mobile_store_purchases_transaction
  ON mobile_store_purchases (store, transaction_key)
  WHERE transaction_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS mobile_store_purchase_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid REFERENCES mobile_store_purchases(id) ON DELETE SET NULL,
  store text NOT NULL CHECK (store IN ('apple', 'google')),
  event_key text NOT NULL,
  transaction_key text,
  operation text NOT NULL CHECK (operation IN ('observe', 'grant', 'reverse')),
  provider_event_type text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'active', 'cancelled', 'expired', 'refunded', 'revoked', 'failed')),
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (store, event_key),
  UNIQUE (store, transaction_key, operation),
  CONSTRAINT mobile_store_purchase_events_event_key_shape_check
    CHECK (char_length(event_key) = 43),
  CONSTRAINT mobile_store_purchase_events_transaction_key_shape_check
    CHECK (transaction_key IS NULL OR char_length(transaction_key) = 43),
  CONSTRAINT mobile_store_purchase_events_provider_type_length_check
    CHECK (char_length(provider_event_type) BETWEEN 1 AND 255),
  CONSTRAINT mobile_store_purchase_events_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

DROP INDEX CONCURRENTLY IF EXISTS idx_mobile_store_purchase_events_purchase;
CREATE INDEX CONCURRENTLY idx_mobile_store_purchase_events_purchase
  ON mobile_store_purchase_events (purchase_id, created_at DESC);

ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS mobile_store_event_key text;

ALTER TABLE credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_mobile_store_event_key_shape_check;

ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_mobile_store_event_key_shape_check
  CHECK (mobile_store_event_key IS NULL OR char_length(mobile_store_event_key) = 43) NOT VALID;

ALTER TABLE credit_ledger
  VALIDATE CONSTRAINT credit_ledger_mobile_store_event_key_shape_check;

ALTER TABLE credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_type_check;

ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_type_check
  CHECK (type IN ('signup_bonus', 'monthly_grant', 'purchase', 'purchase_reversal', 'consume', 'refund')) NOT VALID;

ALTER TABLE credit_ledger
  VALIDATE CONSTRAINT credit_ledger_type_check;

DROP INDEX CONCURRENTLY IF EXISTS idx_credit_ledger_mobile_store_event_unique;
CREATE UNIQUE INDEX CONCURRENTLY idx_credit_ledger_mobile_store_event_unique
  ON credit_ledger (mobile_store_event_key)
  WHERE mobile_store_event_key IS NOT NULL;

ALTER TABLE credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_amount_sign_check;

ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_amount_sign_check
  CHECK (
    (type IN ('consume', 'purchase_reversal') AND amount < 0)
    OR (
      type IN ('signup_bonus', 'monthly_grant', 'purchase', 'refund')
      AND amount > 0
    )
  ) NOT VALID;

ALTER TABLE credit_ledger
  VALIDATE CONSTRAINT credit_ledger_amount_sign_check;
