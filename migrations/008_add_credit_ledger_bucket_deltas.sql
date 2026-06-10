ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS monthly_delta INTEGER,
  ADD COLUMN IF NOT EXISTS purchased_delta INTEGER;

UPDATE credit_ledger
SET monthly_delta = 0,
    purchased_delta = amount
WHERE type IN ('signup_bonus', 'purchase', 'refund')
  AND monthly_delta IS NULL
  AND purchased_delta IS NULL;

UPDATE credit_ledger
SET monthly_delta = amount,
    purchased_delta = 0
WHERE type = 'monthly_grant'
  AND monthly_delta IS NULL
  AND purchased_delta IS NULL;

UPDATE credit_ledger
SET monthly_delta = amount,
    purchased_delta = 0
WHERE type = 'consume'
  AND monthly_after > 0
  AND monthly_delta IS NULL
  AND purchased_delta IS NULL;
