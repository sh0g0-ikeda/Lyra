# Episode export API, queue, and recovery design

## Purpose and scope

This is the final backend wiring slice for asynchronous episode PDF/ZIP export.
It adds authenticated create/status/download routes, a dedicated SQS adapter and
poller, outbox recovery, short-lived download signing, and expired-artifact
cleanup.

It does not add Web or Mobile UI, credits, generation-job rows, or reuse the
generation queue. The existing synchronous
`GET /api/pages/:id/export-image` route is unchanged. Production remains
disabled unless `EPISODE_EXPORT_ENABLED=true` and all export-specific runtime
configuration is present.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` sections 3 and 5: Route / Service /
  Repository / Infrastructure / Worker boundaries, authenticated owner scope,
  opaque storage keys, and short-lived delivery.
- Section 8: bounded Zod input, stable errors, parameterized persistence,
  provider timeouts, and retry of network/429/5xx failures only.
- Section 9: export capacity must remain separate from image generation.
- Section 10: TDD, full verification gates, and production runtime validation.
- `docs/episode-export-backend-design-2026-07-31.md`: the planned HTTP,
  outbox, download, and cleanup contracts.
- `docs/episode-export-worker-design-2026-07-31.md`: immutable snapshots,
  deterministic artifacts, storage limits, and lease-aware processing.

## Interfaces and data flow

### HTTP

- `POST /api/episodes/:episodeId/exports`
  - authenticated and rate limited;
  - optional `organization_id` requires `export`;
  - `Idempotency-Key` is 8..128 visible ASCII characters;
  - strict JSON: `format`, 1..100 unique `page_ids`, optional filename;
  - atomically creates the job and outbox record, then best-effort dispatches;
  - returns `202` with strict `{ job_id, status }`.
- `GET /api/exports/:jobId`
  - repeats personal/organization scope and organization capability checks;
  - retries an undispatched queued outbox record without failing status reads;
  - returns only status, progress, safe error, timestamps, and
    `download_ready`.
- `GET /api/exports/:jobId/download`
  - repeats all scope checks;
  - requires completed, present, unexpired artifact metadata;
  - redirects with `Cache-Control: private, no-store` to an HTTPS URL lasting
    no longer than five minutes or the remaining artifact lifetime.

No route returns a bucket, object key, provider error, stack trace, lease token,
or signed URL inside status JSON.

### Dispatch and recovery

`EpisodeExportDispatchService` sends only versioned
`{ version: 1, export_job_id }` messages to `SQS_QUEUE_URL_EXPORT`. SQS send
success is persisted afterward. If the database acknowledgement is lost, the
same outbox row may be sent again; worker leasing and deterministic storage make
the duplicate harmless.

Creation and status reads perform best-effort dispatch. A bounded periodic
outbox recovery runner lists undispatched, unexpired queued rows and retries
them. Provider failures are reduced to a stable message before persistence.
The API transaction never waits on or rolls back for SQS availability.

### Worker

The export queue has a dedicated parser, batch handler, poller, runtime entry
point, queue URL, visibility timeout, and concurrency. It never calls
`handleGenerationQueue` and never receives a generation job type. Malformed
messages are acknowledged as permanent input failures. Worker retry results and
unexpected processing failures retain the SQS message through partial-batch
failure semantics.

### Download and cleanup

The S3 download signer validates the exact server-derived artifact key, format,
MIME, and bounded TTL, then signs `GetObject` with the normalized safe filename
as attachment metadata.

Cleanup reads a bounded batch of expired completed artifacts, reconstructs and
checks the exact owner/job identity, deletes idempotently, then conditionally
marks the same key deleted. Delete failure leaves the database marker untouched
for retry. The cleanup runner executes at export-worker startup and periodically;
an S3 lifecycle rule remains an operational second layer.

## Security and compatibility

- Route auth and active organization `export` capability are mandatory.
- Repository scope still requires the authenticated creator and active
  organization membership; page snapshot creation still enforces episode and
  owner scope inside the transaction.
- All IDs, body fields, idempotency headers, filenames, queue payloads, TTLs,
  URLs, and batch sizes are bounded.
- Download URLs must be HTTPS and may only target the configured bucket/key.
- Artifacts remain private, `no-store`, encrypted, and job-keyed.
- Export does not consume or refund credits and does not touch
  `generation_jobs`, the generation SQS URL, or generation poller.
- Default-off route mounting and runtime guards preserve current production
  behavior until queue, bucket policy, IAM, lifecycle, and environment values
  are explicitly configured.

## TDD and verification

Tests are added before production modules and must initially fail because the
API, dispatch, queue handler/poller, signer, cleanup, and wiring do not exist.

- Service: idempotent creation, commit-before-send behavior, safe status,
  best-effort recovery, tenant isolation, download readiness/expiry/TTL.
- Route/contract: auth, UUID/header/body bounds, organization capability,
  strict response schemas, no-store redirect, and default-off app mounting.
- SQS: exact versioned payload, sanitized dispatch failure, malformed message,
  processed/skipped/retry/throw handling, delete/visibility behavior.
- Cleanup: exact identity, delete-before-mark, missing object idempotency, and
  retry after delete/mark failure.
- Runtime: feature flag default-off, conditional required keys, export worker
  entry point, and no generation-queue source dependency.

After focused red/green tests: Backend Vitest and Bun suites, TypeScript build,
fresh migrations and invariants, Web lint/build/Playwright smoke, Mobile
contract generation/typecheck/lint/tests, Expo checks, Android/iOS static
exports, production Docker build, and package audit.

## Sol / Terra split

No delegation is used. The active collaboration policy disallows spawning
sub-agents, so the orchestration skill is applied as a local Sol checklist.
Design, security decisions, implementation, review, and verification remain in
one context.
