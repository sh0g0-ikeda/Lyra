ALTER TABLE payment_records
  ADD CONSTRAINT payment_records_exactly_one_external_id_check
  CHECK (
    (stripe_checkout_session_id IS NULL) <> (stripe_invoice_id IS NULL)
  ) NOT VALID;

ALTER TABLE payment_records VALIDATE CONSTRAINT payment_records_exactly_one_external_id_check;
