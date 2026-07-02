ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_plan_code_check;

ALTER TABLE users
  ADD CONSTRAINT users_plan_code_check
  CHECK (plan_code IN ('free', 'standard', 'premium', 'enterprise_a', 'enterprise_b', 'enterprise_c')) NOT VALID;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_code_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_code_check
  CHECK (plan_code IN ('free', 'standard', 'premium', 'enterprise_a', 'enterprise_b', 'enterprise_c')) NOT VALID;

ALTER TABLE users VALIDATE CONSTRAINT users_plan_code_check;
ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_plan_code_check;
