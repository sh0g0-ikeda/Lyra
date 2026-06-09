ALTER TABLE users
  ADD CONSTRAINT users_plan_code_check
  CHECK (plan_code IN ('free', 'standard', 'premium')) NOT VALID;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_code_check
  CHECK (plan_code IN ('free', 'standard', 'premium')) NOT VALID;

ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_type_check
  CHECK (type IN ('signup_bonus', 'monthly_grant', 'purchase', 'consume', 'refund')) NOT VALID;

ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_bucket_delta_pair_check
  CHECK (
    (monthly_delta IS NULL AND purchased_delta IS NULL)
    OR (monthly_delta IS NOT NULL AND purchased_delta IS NOT NULL)
  ) NOT VALID;

ALTER TABLE payment_records
  ADD CONSTRAINT payment_records_kind_check
  CHECK (kind IN ('subscription', 'credit_purchase')) NOT VALID;

ALTER TABLE payment_records
  ADD CONSTRAINT payment_records_status_check
  CHECK (status IN ('paid', 'failed')) NOT VALID;

ALTER TABLE payment_records
  ADD CONSTRAINT payment_records_amount_jpy_check
  CHECK (amount_jpy >= 0) NOT VALID;

ALTER TABLE users VALIDATE CONSTRAINT users_plan_code_check;
ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_plan_code_check;
ALTER TABLE credit_ledger VALIDATE CONSTRAINT credit_ledger_type_check;
ALTER TABLE credit_ledger VALIDATE CONSTRAINT credit_ledger_bucket_delta_pair_check;
ALTER TABLE payment_records VALIDATE CONSTRAINT payment_records_kind_check;
ALTER TABLE payment_records VALIDATE CONSTRAINT payment_records_status_check;
ALTER TABLE payment_records VALIDATE CONSTRAINT payment_records_amount_jpy_check;
