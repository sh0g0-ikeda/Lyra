# Disabled export runtime containment (2026-08-19)

## Design brief

- **Purpose and scope:** contain the disabled episode-export runtime on the
  deployed `a0b612d` API line.  The default composition must not register the
  export HTTP routes or construct export persistence, S3, SQS, initial work, or
  maintenance timers unless the feature is explicitly enabled and configured.
  Direct dependency injection remains available to isolated route tests.
- **Spec basis:** Unified Spec sections 3 (composition boundaries), 5 (storage
  and persistence), 9 (availability), and 10 (verification).  The production
  incident evidence is recorded in the operator handoff rather than duplicated
  in this branch.
- **Affected layers:** API composition (`src/app.ts`), process startup
  (`src/index.ts`), and environment/runtime configuration.  Routes, services,
  repositories, migrations, export records, account deletion, mobile, and
  production state are out of scope.
- **Interface:** `EPISODE_EXPORT_ENABLED` is false by default.  A pure runtime
  predicate is true only with that flag and both existing S3/generation-SQS
  settings.  It guards construction at both default composition points.
- **Security and availability:** fail closed; no newly exposed route or access
  to missing export tables while disabled.  Existing authentication and explicit
  test injection are unchanged.  No secret values are logged.
- **TDD and verification:** first add tests for the fail-safe flag/predicate,
  zero gated construction, disabled default routing, and explicit route-test
  injection; observe RED; then implement the smallest wiring.  Run focused
  Vitest, backend build, affected app/route tests, and a final diff check.
- **Terra delegation:** none.  The change is a tightly coupled three-file
  composition patch; splitting it would make the TDD gate and integration
  review slower without a disjoint write scope.

## Rollout runbook

1. Build only this branch from `a0b612d`; do not apply or edit export
   migrations as part of containment.
2. Keep `EPISODE_EXPORT_ENABLED=false`; deploy the API image only.
3. Verify `/healthz` and `/readyz`, export-route absence, and no export DB/S3/
   SQS/timer activity for at least two dispatch intervals plus the former cleanup
   window.  Confirm generation queues and jobs remain healthy.
4. Roll back only if required, retaining the flag false.  Export can be enabled
   later only after the separate read-only schema preflight and migration review.
