# Mobile Production Migration Rollout Design

## Purpose and scope

Prepare migrations `027` through `036` for a production one-off rollout without
changing an already applied migration or weakening the strict Apple/AASA build
guard. This work fixes the push outbox cancellation guard, adds a schema-026
compatible pre-migration check, and makes a backend-only migration image
buildable without the Web stage.

The Mobile branch originally used filenames `024` through `032` before the
mainline `024` through `026` migrations were merged. Some development or
staging databases may therefore contain the legacy filenames. The runner
records canonical aliases only for the seven content-equivalent renames. It
also aliases the content-equivalent store-ledger migration. It deliberately
reapplies only the changed generation-job-management and
processing-cancellation migrations under canonical filenames.

The application service rollout, Apple configuration, store configuration, and
physical-device acceptance remain separate release gates.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md`: forward-only migrations, deployment
  invariants, one-off migration task, readiness, worker health, queue and log
  review.
- `docs/mobile_completion_gap_spec.md`: production rollout and authoritative
  external acceptance evidence.

## Affected layers and interfaces

- Migration: add `036_fix_push_notification_cancelled_guard.sql`; do not edit
  `034_add_mobile_push_notification_outbox.sql`.
- Ops verification: add a schema-026-compatible preflight command that never
  queries objects introduced by migrations `027` or later.
- Infrastructure: split `runtime-base`, `migration-runtime`, and `runtime`
  Docker stages. The migration target contains production dependencies,
  compiled backend code, migrations, and RDS certificates, but no Web assets.
- Production: run the preflight and migration as ECS one-off tasks using the
  same runtime secret, task role, subnets, and security group as the API.
  `ecs-pre-migration-overrides.json` runs only the schema-026 preflight, while
  `ecs-migrate-overrides.json` runs the migration entrypoint.

## Safety contract

- `cancelled -> failed` must not enqueue an outbox row. A normal non-terminal
  transition to `completed` or `failed` must still enqueue exactly once.
- Preflight must run against schema `026`, check migration baseline, invalid
  indexes, legacy credit linkage, cancellation metadata pairs, and rows that
  would violate migration `029` constraints without referencing future tables
  or columns.
- The production preflight accepts only the canonical `001` through `026`
  lineage. Legacy branch databases use the explicit runner reconciliation path
  and full post-migration invariants; they are not accepted as production
  schema-026 baselines.
- Legacy Mobile filename reconciliation is allowed only for known
  content-equivalent migrations. Before canonical `024`, the runner forward
  converts legacy `canceled` rows and the legacy cancellation requester column.
  It must not suppress canonical `030` or `035`, because those files changed
  during mainline integration.
- Migrations `028`, `029`, `030`, and `035` require a maintenance window:
  drain API writes, scale workers to zero, and wait for in-flight DB work.
- `029` remains non-transactional because it uses concurrent indexes. A failed
  run is investigated and resumed forward; destructive rollback is forbidden.
- The API and worker task-definition revisions are recorded before rollout.
  Database changes remain after an application rollback.
- Secrets remain in Secrets Manager and are never written to build arguments,
  source, logs, or task-definition environment values.

## Test and verification plan

1. Add failing unit and PostgreSQL behavior tests for migration `036`.
2. Add failing preflight tests proving it does not reference post-026 schema.
3. Add failing Dockerfile tests for the migration-only target.
4. Implement the migration, preflight, and Docker target.
5. Verify both a clean `001` through `036` database and a database containing
   the legacy Mobile filenames; both must pass all deployment invariants.
6. Run focused tests, full Backend tests/build/invariants, and build/probe the
   ARM64 migration image locally.
7. Before production, verify RDS snapshot/PITR capability and record the
   current API and worker task revisions.
8. Enter maintenance, stop API writes, scale workers to zero, and wait for
   in-flight work to finish.
9. After the drain, take the final snapshot or record the final recoverable
   PITR time, then run the schema-026 preflight. Run the one-off migration,
   run full invariants, deploy API followed by worker, and reopen ingress only
   after readiness and queue checks pass.

## Sol/Terra split

Terra performed the read-only migration-by-migration compatibility audit. Sol
owns the forward repair, preflight design, Docker integration, production
decision, and final verification.

## Published migration image

- Source commit: `59605ed42c26cb2f4936c7272ca0a33eb8ee1c7d`
- ECR tag: `lyra-prod-api:migration-59605ed-arm64`
- OCI index digest:
  `sha256:da810033a7bc1c763b704d49f3db600c46ef01e34e74ffa10e6327b3ff88bfb4`
- Readback platform: `linux/arm64`
- Status: published only; no ECS task or production migration has run.
