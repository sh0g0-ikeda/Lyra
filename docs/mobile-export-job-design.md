# Mobile asynchronous export job design

## Purpose and scope

MOB-PAGE-011 requires multi-page PDF and ZIP exports to be assembled on the
server. This design adds an authenticated, tenant-scoped export-job contract
without changing existing synchronous single-page image export behavior.

## Non-goals

- Exports do not bill credits and do not reuse `generation_jobs`.
- The API never returns a storage key or a provider error.

## Spec basis

`Lyra_Unified_Spec_v4.md` sections 3-10: layer boundaries, authenticated
personal/organization ownership, opaque storage keys, bounded external calls,
and verification requirements. `mobile_completion_gap_spec.md` MOB-PAGE-011
requires server-side asynchronous multi-page PDF/ZIP export with an
authenticated completion/download flow.

## Layers and interfaces

- **Domain**: bounded export format/status/progress contracts and filename
  sanitization.
- **Route**: validates body/query/idempotency header, requires authentication
  and organization `export` capability, and maps safe responses.
- **Service**: creates idempotent jobs, exposes tenant-scoped status/download
  metadata, and coordinates worker state transitions.
- **Repository**: parameterized SQL creates `export_jobs` plus durable
  `export_job_outbox`, captures authorized page-image snapshots, and atomically
  claims/completes/fails jobs.
- **Infrastructure**: S3 reads bounded source images, stores opaque artifacts,
  and creates short-lived signed downloads. PDF and ZIP builders run only on
  server buffers.
- **Worker**: claims queued export work, builds the requested artifact, records
  bounded progress, and stores only stable error codes/messages.
- **Mobile**: selects generated pages, requests PDF or ZIP with an idempotency
  key, polls the tenant-scoped job, and downloads/shares only the completed
  short-lived HTTPS artifact. Single-page image export stays synchronous.

## Security

- `page_ids` is restricted to 1..100 UUIDs; duplicate IDs and pages outside
  the authenticated episode/scope are rejected.
- The repository scopes personal records to the requester and organization
  records to active membership; routes additionally enforce the `export`
  capability.
- Filename input is normalized to a safe basename and cannot affect S3 paths.
- Artifact S3 keys are generated from the job UUID. S3 keys, raw AWS errors,
  and provider details are never exposed.
- Source MIME/size, total export size, S3 operation timeout, retryable reads,
  signed-URL TTL, artifact expiry, and idempotency-key length are bounded.

## Tests

TDD coverage includes route authentication/validation/scope, service
idempotency and safe error serialization, repository/migration contracts, and
PDF/ZIP artifact signatures and content bounds. Target verification is the
export test set followed by `bun run build`. Mobile tests cover page selection,
request construction, organization scope, idempotency headers, safe job
rendering, and completed-download behavior, followed by typecheck and lint.

## Integration

`src/app.ts` must construct `PostgresExportJobRepository`,
`S3ExportArtifactStorage`, `EpisodeExportService`, and mount
`createExportRoutes` under `/api`. `src/index.ts`/worker wiring must resolve an
export queue/outbox dispatcher and route an `episode_export` SQS payload to
`EpisodeExportWorkerService.processJob`. Production S3 lifecycle must delete
`exports/` artifacts after their `expires_at` window; schedule
`ExportArtifactCleanupService.cleanupExpiredArtifacts` as the application-side
checkpoint so already-removed objects are not retried indefinitely. Invoke
`ExportOutboxDispatchService.dispatchPending` on startup and on a bounded
interval so a queue outage after the transaction commits cannot strand a job.

`PagesScreen` must not call the legacy device-side multi-page PDF builder.
Its PDF/ZIP controls create one backend job, display `ExportJobCard`, and pass
the returned short-lived URL directly to the native downloader/share sheet.
The same request keeps its idempotency key across transport retries. Changing
episode, page selection, format, or filename produces a new request identity.
