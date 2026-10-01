-- lyra:migration no-transaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_ledger_stripe_event_unique
  ON credit_ledger(stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_records_checkout_session_kind_status_unique
  ON payment_records(stripe_checkout_session_id, kind, status)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_records_invoice_kind_status_unique
  ON payment_records(stripe_invoice_id, kind, status)
  WHERE stripe_invoice_id IS NOT NULL;
