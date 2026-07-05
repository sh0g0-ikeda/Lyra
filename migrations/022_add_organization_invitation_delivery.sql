-- Track enterprise invitation delivery without storing raw invitation tokens
-- or email body content. Existing invitation creation and acceptance continue
-- to work when email delivery is disabled.

ALTER TABLE organization_invitations
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_status text NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS send_error_code text,
  ADD COLUMN IF NOT EXISTS send_error_message text,
  ADD COLUMN IF NOT EXISTS resend_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE organization_invitations
  DROP CONSTRAINT IF EXISTS organization_invitations_send_status_check,
  ADD CONSTRAINT organization_invitations_send_status_check
    CHECK (send_status IN ('not_sent', 'sending', 'sent', 'failed'));

ALTER TABLE organization_invitations
  DROP CONSTRAINT IF EXISTS organization_invitations_resend_count_nonnegative_check,
  ADD CONSTRAINT organization_invitations_resend_count_nonnegative_check
    CHECK (resend_count >= 0);

CREATE TABLE IF NOT EXISTS email_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  invitation_id uuid REFERENCES organization_invitations(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  template_key text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL,
  provider_message_id text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT email_delivery_logs_recipient_email_length_check
    CHECK (char_length(trim(recipient_email)) BETWEEN 3 AND 320),
  CONSTRAINT email_delivery_logs_template_key_length_check
    CHECK (char_length(trim(template_key)) BETWEEN 1 AND 120),
  CONSTRAINT email_delivery_logs_provider_length_check
    CHECK (char_length(trim(provider)) BETWEEN 1 AND 80),
  CONSTRAINT email_delivery_logs_status_check
    CHECK (status IN ('sending', 'sent', 'failed', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_invitation_created
  ON email_delivery_logs (invitation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_organization_created
  ON email_delivery_logs (organization_id, created_at DESC);
