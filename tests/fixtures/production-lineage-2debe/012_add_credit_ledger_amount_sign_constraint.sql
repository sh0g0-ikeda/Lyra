ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_amount_sign_check
  CHECK (
    (type = 'consume' AND amount < 0)
    OR (
      type IN ('signup_bonus', 'monthly_grant', 'purchase', 'refund')
      AND amount > 0
    )
  ) NOT VALID;

ALTER TABLE credit_ledger VALIDATE CONSTRAINT credit_ledger_amount_sign_check;
