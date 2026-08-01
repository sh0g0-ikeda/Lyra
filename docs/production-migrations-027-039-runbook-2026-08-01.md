# Production migrations 027-039 runbook

## Purpose

Move production from schema 026 to 039 without accepting writes against a
half-migrated schema. This runbook is intentionally fail-closed. Feature flags
for mobile billing, account deletion, and episode export remain `false` during
this rollout.

## Scope and non-goals

- Apply the existing additive migrations 027-039 in filename order.
- Deploy one immutable backend image to the generation worker and API.
- Do not enable store billing, account deletion, episode export, push delivery,
  or any new mobile client UI.
- Do not delete tables, columns, ledger rows, images, users, or jobs.

## Required evidence before mutation

Record without exposing secret values:

- release commit, image tag, and ECR digest;
- current API and generation-worker task definition ARNs and image digests;
- desired/running/pending counts and deployment status;
- database instance status, automated-backup retention, latest restorable time,
  deletion protection, and encryption;
- generation queue and DLQ visible/in-flight counts;
- enabled/disabled state of all feature flags by name only;
- recent API and worker error counts.

Stop if an image digest is not the reviewed release, either service is already
unhealthy, the DLQ is non-empty, or the database cannot be restored to a point
immediately before migration.

## Drain and preflight

1. Record the API and worker desired counts, then scale the API service to zero.
   This is a short planned outage, but it is the available fail-closed method for
   preventing new generation and edit writes during this schema jump.
2. Wait for the generation queue visible and in-flight counts to reach zero and
   for `generation_jobs` to contain no `queued` or `processing` rows.
3. Scale the generation worker to zero only after the drain completes.
4. Create a final manual RDS snapshot and wait until it is `available`. Record
   the snapshot identifier and latest PITR time.
5. Run a one-off ECS task from the exact release image with
   `ecs-pre-migration-check-overrides.json`.
6. Require exit code zero and a JSON report with `ok: true`.

The preflight is read-only and verifies the exact 001-026 migration set, absence
of partial 027-039 tables, invalid indexes, active jobs, existing schema-026 data
contracts, refunds, and cancellation metadata. Any violation is a hard stop.

## Migration and deployment order

1. Run one one-off ECS task from the same release image with
   `ecs-migrate-overrides.json`.
2. Require exit code zero. Do not rerun blindly after a failure because 029 and
   030 contain non-transactional concurrent-index statements. Inspect
   `schema_migrations`, invalid indexes, and created objects first.
3. Run `bun run db:check-invariants:prod` from the same image. Require `ok: true`.
4. Register new worker and API task definitions using the immutable image
   digest. Explicitly keep `MOBILE_STORE_BILLING_ENABLED=false`,
   `ACCOUNT_DELETION_ENABLED=false`, and `EPISODE_EXPORT_ENABLED=false`.
5. Start the generation worker and wait for a stable deployment before updating
   the API. Do not start export or deletion workers.
6. Update the API and wait for ECS service stability and healthy target-group
   registration.
7. Restore the recorded API desired count only after the worker is stable, then
   complete authenticated read/write smoke checks.

## Verification

- readiness and health endpoints succeed;
- one authenticated read and one non-generation edit/save succeed;
- no raw provider errors or secrets appear in responses or logs;
- API/worker desired and running counts match, with no pending tasks;
- target group is healthy;
- generation queue and DLQ remain empty;
- schema migration history ends at
  `039_connect_generation_terminal_push_outbox.sql`;
- post-migration invariant report is `ok: true`;
- credit balances and consume/refund invariants remain unchanged;
- mobile billing, deletion, and export routes remain unavailable while flags are
  off.

## Rollback and stop rules

After schema 039 is applied, do not run down-migrations and do not restore the
database merely to roll back application code. The migrations are additive, but
old task definitions may not understand all new trigger behavior. Prefer
forward-fixing the reviewed release. If application rollback is unavoidable,
scale the API and workers to zero, assess old-code/schema-039 compatibility, and
only then select a recorded task definition.

Stop and investigate on any migration failure, invalid index, invariant
violation, non-zero one-off task exit, unhealthy target, queue growth, credit or
refund discrepancy, repeated 5xx, or secret-bearing log entry. Database restore
is the last-resort recovery path for confirmed destructive corruption, using the
recorded snapshot/PITR point.
