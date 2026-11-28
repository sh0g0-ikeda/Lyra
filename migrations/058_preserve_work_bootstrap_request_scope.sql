-- A request's original organization scope must survive legacy organization
-- deletion. SET NULL would merge independent request keys into personal scope
-- and can make the existing organization-delete operation fail uniqueness.
-- Keep the opaque scope UUID; actor deletion still removes both records.
ALTER TABLE work_creation_metadata
  DROP CONSTRAINT work_creation_metadata_organization_id_fkey;
ALTER TABLE work_bootstrap_request_ledger
  DROP CONSTRAINT work_bootstrap_request_ledger_organization_id_fkey;
