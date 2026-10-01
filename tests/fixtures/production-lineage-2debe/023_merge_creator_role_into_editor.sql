UPDATE organization_members
SET role = 'editor', updated_at = NOW()
WHERE role = 'creator';

UPDATE organization_invitations
SET role = 'editor', updated_at = NOW()
WHERE role = 'creator';

ALTER TABLE organization_members
  DROP CONSTRAINT IF EXISTS organization_members_role_check;

ALTER TABLE organization_members
  ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('owner', 'admin', 'billing', 'editor', 'viewer'));

ALTER TABLE organization_invitations
  DROP CONSTRAINT IF EXISTS organization_invitations_role_check;

ALTER TABLE organization_invitations
  ADD CONSTRAINT organization_invitations_role_check
  CHECK (role IN ('owner', 'admin', 'billing', 'editor', 'viewer'));
