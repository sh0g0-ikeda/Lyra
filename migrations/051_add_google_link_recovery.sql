-- Durable source-subject retirement prevents a detached external identity from
-- provisioning a second Lyra user after its provider profile is removed.
CREATE TABLE retired_auth_subjects (
  subject_key TEXT PRIMARY KEY CHECK (char_length(subject_key) = 43),
  destination_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Implicit writers stay conservative during mixed-version rollout: a missing
-- phase is attempted, while the recovery-aware writer sets ready explicitly.
-- Only rows already confirmed linked before this migration are backfilled.
ALTER TABLE oauth_identity_links
  ADD COLUMN operation_phase TEXT NOT NULL DEFAULT 'attempted'
    CHECK (operation_phase IN ('ready', 'attempted', 'rejected', 'linked')),
  ADD COLUMN source_subject_key TEXT
    CHECK (source_subject_key IS NULL OR char_length(source_subject_key) = 43);

UPDATE oauth_identity_links
SET operation_phase = 'linked'
WHERE status = 'linked';
