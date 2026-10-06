ALTER TABLE mobile_store_purchases
  ADD COLUMN IF NOT EXISTS scheduled_product_id text,
  ADD COLUMN IF NOT EXISTS scheduled_plan_code text,
  ADD COLUMN IF NOT EXISTS scheduled_effective_at timestamptz;

ALTER TABLE mobile_store_purchases
  DROP CONSTRAINT IF EXISTS mobile_store_purchases_scheduled_plan_check;

ALTER TABLE mobile_store_purchases
  ADD CONSTRAINT mobile_store_purchases_scheduled_plan_check CHECK (
    (
      scheduled_product_id IS NULL
      AND scheduled_plan_code IS NULL
      AND scheduled_effective_at IS NULL
    )
    OR (
      kind = 'subscription'
      AND scheduled_product_id IS NOT NULL
      AND scheduled_plan_code IN ('standard', 'premium')
    )
  );
