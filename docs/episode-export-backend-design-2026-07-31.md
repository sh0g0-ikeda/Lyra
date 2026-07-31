# Episode export backend design

## Purpose and scope

Provide asynchronous, server-built PDF and ZIP export for selected generated
pages in one episode. The implementation is split into independently reviewable
changes:

1. processing-lease persistence and the repository contract;
2. artifact builder, bounded storage adapter, and dedicated worker;
3. authenticated API, durable outbox dispatch, and dedicated export queue.

The existing synchronous single-page
`GET /api/pages/:id/export-image` route and `PageExportService` are not changed.
Exports do not consume credits and do not reuse `generation_jobs`.

The feature remains disabled by default until the dedicated queue, worker, IAM,
bucket lifecycle, alarms, and real PDF/ZIP smoke evidence are read back from the
target environment.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` sections 3, 4, and 5: layer boundaries,
  authenticated personal or active-organization scope, opaque storage keys, and
  asynchronous owner-scoped export artifacts.
- Section 8: bounded input/output, provider timeout and retry classification,
  server-owned storage paths, and safe errors.
- Section 10: TDD and the complete release verification gate.
- Applied migration `032_add_episode_export_jobs.sql` is authoritative and is
  never edited.

## Existing contract and rejected legacy implementation

Migration 032 creates:

- `episode_export_jobs`;
- `episode_export_job_outbox`;
- artifact keys in the exact form
  `exports/{organizationId-or-userId}/episodes/{episodeId}/{jobId}.{format}`.

PR #67 used `export_jobs`, `export_job_outbox`, and
`exports/{jobId}.{format}`. Those names and keys do not match migration 032 and
would fail at runtime or violate the completed-artifact check constraint.
Therefore no export file from PR #67 is cherry-picked. Only its general
Route/Service/Repository/Worker separation and PDF/ZIP construction approach
are treated as reference material.

## Processing lease extension

An export can take longer than a normal request and can be redelivered by SQS.
Migration 032 alone cannot distinguish an old worker from a replacement worker
after a crash. A new additive migration introduces:

- `attempt_count`;
- `processing_lease_token`;
- `processing_lease_expires_at`;
- `last_heartbeat_at`.

New processing writes must have one bounded lease. Claiming is atomic and may
reclaim only an expired lease. Progress, completion, failure, and retry release
must match the lease token. A stale worker therefore cannot overwrite a newer
worker's terminal state. The new constraint is `NOT VALID` so deployment does
not silently rewrite unknown production rows; deployment invariants detect
legacy violations before an explicit later validation.

The expired-lease index is intentionally created in the same additive migration.
No API or worker currently produces export rows, so the table should be empty.
Production rollout must still read back the row count before migration; if rows
exist unexpectedly, migration is paused and the index is moved to a separately
reviewed concurrent operation rather than accepting an unbounded write lock.

## Planned HTTP contract

`POST /api/episodes/:episodeId/exports`

- authenticated;
- optional `organization_id` with `export` capability;
- `Idempotency-Key`: 8..128 safe ASCII characters;
- strict body with format `pdf` or `zip`, 1..100 unique page UUIDs, and an
  optional bounded filename;
- returns `202 { "job_id": "uuid", "status": "queued" }`.

`GET /api/exports/:jobId`

- returns only tenant-scoped status, bounded progress, stable error code/message
  key, expiry, and whether a download is ready;
- never returns an S3 key, raw provider error, or signed URL.

`GET /api/exports/:jobId/download`

- repeats authentication and tenant/capability checks;
- only completed, non-deleted, non-expired artifacts are accepted;
- returns a redirect to an HTTPS URL whose lifetime is the smaller of five
  minutes and the artifact's remaining lifetime.

## Repository and tenancy

Creation runs in one PostgreSQL transaction:

1. read the same-scope idempotency record;
2. lock and snapshot exactly the requested generated pages from the requested
   episode through personal ownership or active organization membership;
3. reject missing, duplicate, cross-episode, unsupported, or imageless pages as
   one request;
4. insert `episode_export_jobs`;
5. insert `episode_export_job_outbox`.

The snapshot order follows the requested page order and is immutable for the
job. Filename input never participates in an S3 path. Duplicate SQS messages
are harmless because only one valid lease can process the job.

## Worker and storage boundaries

Export work uses a dedicated `SQS_QUEUE_URL_EXPORT` and worker so large
documents cannot consume image-generation concurrency.

The worker:

- loads only the persisted snapshot;
- validates each page key against the personal owner or page ID;
- heartbeats the lease between bounded operations;
- limits a source image to 20 MiB, total source bytes to 64 MiB, pages to 100,
  and the artifact to 128 MiB;
- builds deterministic PDF or ZIP bytes on the server;
- stores to the migration-032 key with private cache control and SSE;
- retries only explicit timeout, network, 429, and 5xx failures;
- releases its lease before requesting SQS retry;
- persists only stable error codes and safe messages for permanent failures.

S3 source reads use HEAD followed by a size-bounded Range GET and verify MIME,
size, ETag, returned range, byte length, and image magic bytes. Artifact PUT is
idempotent because the key and bytes are derived from the immutable job. All
provider operations have bounded timeouts.

## Outbox and cleanup

The API transaction never depends on SQS availability. After commit it attempts
to dispatch the matching outbox row. Creating the same request again and
polling a still-queued job both retry an undispatched row. Standard-queue
duplicates are accepted and stopped by the processing lease.

Expired downloads are rejected before signing. Cleanup deletes only the exact
server-derived artifact key and marks `artifact_deleted_at` afterward. The S3
`exports/` lifecycle is a second recovery layer and must expire objects after
the database's 24-hour lifetime with an operational grace period.

## TDD and verification

Tests are written before each production slice.

Persistence and repository:

- additive migration shape, fresh migration, invariant detection;
- exact `episode_export_*` table names and migration-032 artifact key;
- personal and active-organization scope;
- idempotency replay and conflict;
- atomic claim, expired reclaim, heartbeat, stale-token rejection, retry
  release, completion/failure, and exhausted/expired terminalization.

Worker and storage:

- valid PDF and ZIP signatures/content;
- safe page-key policy;
- HEAD/Range GET MIME, size, ETag, range, and magic-byte mismatch;
- individual, total, artifact, and pixel limits;
- timeout/network/429/5xx retry only;
- retryable release, permanent fail, crash/redelivery, and stale-worker cases.

API and dispatch:

- authentication, UUID/body/header bounds, capability, and tenant isolation;
- outbox commit-before-send, recovery, duplicate dispatch safety;
- strict shared Mobile response contracts;
- download readiness, expiry, HTTPS, and remaining-TTL bounds;
- app/worker wiring while the feature is default-off;
- regression of synchronous single-page export.

Each slice runs focused red/green tests, both Vitest and Bun suites, backend
build, fresh migrations and invariants, Web lint/build/E2E, Mobile
contract/typecheck/lint/test, Expo checks, and Android/iOS static exports before
merge.

## Sol / Terra split

Sol owns design, migration safety, state transitions, integration, and final
verification. Terra performed a read-only comparison of main, migration 032,
adjacent implementations, and PR #67. Terra made no edits and did not make the
integration decision.
