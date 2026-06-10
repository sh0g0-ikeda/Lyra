ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (
    status IN (
      'active',
      'canceled',
      'incomplete',
      'incomplete_expired',
      'past_due',
      'paused',
      'trialing',
      'unpaid'
    )
  ) NOT VALID;

ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_status_check;
