-- lyra:migration no-transaction
-- Build organization indexes outside a transaction so production writes are not
-- blocked by large table index creation.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_organization_updated
  ON works (organization_id, updated_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_members_user
  ON organization_members (user_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_members_org
  ON organization_members (organization_id, status, role);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_usage_events_org_created
  ON organization_usage_events (organization_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_audit_logs_org_created
  ON organization_audit_logs (organization_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_organization
  ON generation_jobs (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;
