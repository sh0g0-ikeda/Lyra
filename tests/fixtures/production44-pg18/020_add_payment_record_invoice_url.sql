ALTER TABLE payment_records
  ADD COLUMN IF NOT EXISTS invoice_url TEXT;

