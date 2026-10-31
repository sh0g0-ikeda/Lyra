-- Shared, non-tenant operational state. No user content, balance or job mutation.
CREATE TABLE generation_worker_warm_controls (
  resource_id text PRIMARY KEY CHECK (length(resource_id) BETWEEN 1 AND 200),
  lease_until timestamptz,
  last_applied_floor smallint CHECK (last_applied_floor IN (0, 1)),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
