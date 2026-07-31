# Episode export worker and storage design

## Purpose and scope

This is the second reviewable slice of asynchronous episode export. It adds:

- a bounded PDF/ZIP artifact builder;
- export-specific AWS and local source-image loaders;
- export artifact storage and cleanup adapters;
- a lease-aware `EpisodeExportWorkerService`.

It does not add an HTTP route, SQS dispatch, a queue poller, runtime environment
variables, or production enablement. Those remain in the following API/queue
slice. The existing generation worker, `generation_jobs`, credit settlement,
and synchronous single-page image export are not changed.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` sections 3 and 5: Infrastructure and Worker
  boundaries, owner-scoped opaque object keys, and asynchronous short-lived
  export artifacts.
- Section 8: bounded file input/output, safe errors, provider timeout, and
  retry of network/429/5xx failures only.
- Section 9: export work must not consume API or generation-worker capacity.
- Section 10: TDD, full verification gates, and production runtime checks.
- `docs/episode-export-backend-design-2026-07-31.md`: the persisted snapshot,
  lease, artifact key, retry, and cleanup contract.

## Interfaces and data flow

The worker receives only an export job ID from a future dedicated queue.

1. Generate a fresh UUID lease token and atomically claim a queued or expired
   processing job through `EpisodeExportJobRepository`.
2. Validate every persisted source key against its page ID.
3. Heartbeat before bounded external or CPU-heavy stages.
4. Load each image with the job snapshot MIME type, 20 MiB individual limit,
   ETag consistency, Range validation, and image magic-byte validation.
5. Reject more than 64 MiB of combined source bytes.
6. Build either:
   - PDF: decode with Sharp under pixel/time limits, rotate from image
     orientation, convert to bounded JPEG, and embed one image per page;
   - ZIP: preserve the verified source bytes under server-generated page
     filenames and use level 0 because PNG/JPEG/WebP are already compressed.
7. Reject an empty or greater-than-128-MiB artifact.
8. Store only at the migration-032 server-derived artifact key with private
   cache control and server-side encryption.
9. Complete the row only with the current live lease token.

The builder uses `pdf-lib@1.17.1` and `fflate@0.8.3`, the current package
versions at design time. Both are pure JavaScript and are added at exact
lockfile-resolved versions. The separately reviewed `sharp@0.35.3` security
upgrade landed first in PR #129; this slice consumes that version without
changing its package contract.

## Determinism and duplicate delivery

PDF metadata uses the persisted job creation timestamp. ZIP entry time uses a
fixed local 1980 timestamp. Page order and server-generated filenames come only
from the immutable persisted snapshot. Rebuilding the same job therefore
produces identical bytes in tests, allowing an SQS duplicate or replacement
worker to write the same job-owned key safely.

Every mutation after claim includes the current lease token. A stale worker
cannot heartbeat, update progress, release, fail, or complete after a newer
worker claims the job. If artifact storage succeeds but completion loses the
lease, the deterministic job-owned object may be safely overwritten by the
replacement and is never exposed until the database reaches `completed`.

## Source-image safety

The AWS loader:

- accepts only the persisted `image/png`, `image/jpeg`, or `image/webp` MIME;
- uses HEAD before GET;
- requires a safe ETag and a content length from 1 through 20 MiB;
- sends `Range: bytes=0-{size-1}` and `If-Match` with the verified ETag;
- verifies GET MIME, ETag, content length, content range, byte count, and magic
  bytes;
- bounds each provider call with an abort timeout;
- retries only timeout/network errors, 429, and 5xx;
- converts not-found, precondition, malformed metadata, or invalid image data
  into stable permanent export errors.

The artifact adapter accepts only the exact UUID-based
`exports/{scope}/episodes/{episode}/{job}.{pdf|zip}` shape and matching MIME.
User filenames never enter an S3 key or provider header.

## Failure policy

- Retryable source/storage infrastructure error: release the current lease and
  request queue retry.
- Invalid source, unsafe key, oversized input/artifact, or malformed image:
  persist a stable permanent failure.
- Lost heartbeat, progress, release, fail, or completion lease: request queue
  retry without overwriting another worker.
- Already completed/failed/canceled job: acknowledge as skipped.
- Still-active processing job: retry after SQS visibility.
- Queued/expired job that cannot be claimed because attempts or remaining
  lifetime are exhausted: terminalize through `failUnclaimable`.

Raw AWS, Sharp, PDF, ZIP, stack, bucket, and object-key details are never
persisted as user-visible errors.

## TDD and verification

Tests are added before production modules and must fail because those modules
do not exist.

- Artifact builder: PDF page count/signature, ZIP entries/signature, requested
  ordering, deterministic output, WebP conversion, invalid image, pixel and
  artifact limits.
- AWS loader/storage: HEAD/Range/If-Match, MIME/size/ETag/range/magic mismatch,
  timeout and retry classification, exact key/MIME, private/SSE PUT, cleanup.
- Local adapters: traversal protection, exact artifact path, source and
  artifact limits.
- Worker: success, total byte bound, stale token, retryable release, permanent
  failure, expired reclaim, exhausted terminalization, and no credit or
  generation-worker dependency.

After focused green tests: package production audit, Backend Vitest and Bun,
TypeScript build, fresh migrations/invariants, Web lint/build/E2E, Mobile
contracts/typecheck/lint/tests, Expo checks, and Android/iOS exports.

## Sol / Terra split

Sol owns this design, dependency decision, error classification, lease
integration, and final verification. No sub-agent is used because the active
collaboration policy does not authorize delegation in this turn; the audit and
implementation are performed locally as one reviewable file set.
