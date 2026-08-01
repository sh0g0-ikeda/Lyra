# Mobile Page image generation

Date: 2026-08-01

## Purpose and scope

Connect the Mobile Pages tab to the existing Page image-generation contract.
The user selects one saved Page, resolves unsaved Scene, Page-setting, and Panel
drafts, starts exactly one existing `page_generate` job, observes only that
Page's exact job, and sees the generated image from the refreshed Page record.

This slice includes initial generation, regeneration from current saved inputs,
basic readiness feedback, exact job recovery, and authenticated image display.
It does not add Page confirm/reopen, Frame/Balloon editing, thumbnail generation,
export-job UI, asset deletion, or a new Backend save-and-generate endpoint.

The implementation is Mobile-only. It must not change Backend routes, services,
repositories, database migrations, shared API schemas, prompt construction,
queue messages, workers, provider calls, credit calculation, or refund behavior.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` sections 2 and 6: generate from current saved
  inputs, represent long-running work as `generation_jobs`, and preserve active
  resource uniqueness.
- Section 4: keep personal and organization access scoped.
- Section 5: generated-image delivery uses a short-lived signed URL or an
  authenticated export route.
- Section 7: Page generation is chargeable and Backend remains the authority for
  the actual credit cost, deduction, and refund.
- Sections 8 and 10: validate responses and pass the complete release gate.

## Existing contracts used without modification

- `POST /api/pages/:id/generate?organization_id=...`
- HTTP 202 strict response `{ "job_id": UUID }`
- `GET /api/jobs` and `GET /api/jobs/:id`
- `page_generate` with `params.page_id`
- `GET /api/episodes/:id/pages`
- `GET /api/pages/:id/export-image?organization_id=...`
- existing `PageRecord.generated_image`

The Mobile API client adds only a typed wrapper around the existing generate
route. The generated contract file already contains the accepted-job and Page
job schemas, so neither contract source nor generated copy changes.

## Save-before-generate boundary

`PagesScreen` already owns the ordered dirty-resolution workflow. Page image
generation calls that workflow and preserves this exact order:

1. Scene draft
2. Page settings draft
3. Panel content and entity-assignment drafts

Each step may save, discard, or cancel. A cancel, validation failure, conflict,
or save failure stops before the generation POST. After the drafts are resolved,
the Page list is fetched authoritatively and the exact target Page is checked
again. The client blocks obvious invalid states: missing target, wrong Episode,
`confirmed`, `generating`, zero Panels/Frames, or unequal Panel/Frame counts.
The Backend remains the final concurrency, reference, credit, and admission
authority. The Pages screen enters its resource-operation lock before dirty
resolution starts, so no new Scene, Page-setting, or Panel mutation can begin in
the interval between the saved snapshot and the generation POST. The lock is
released on cancel or failure and transferred to exact-job tracking on success.
Preparation locking is distinct from an active generation lock: controls are
read-only to the user, while the already-started dirty-resolution workflow may
still perform only its explicitly confirmed Page-setting and Panel saves. This
prevents the lock from blocking its own asynchronous save confirmation.
Already selected Work, Chapter, Episode, Scene, Page-setting target, and Panel
target controls are disabled during preparation, so a competing selection flow
cannot start while the saved snapshot is being established.

## Job identity, polling, and recovery

The Page image section is separate from Episode skeleton/story-autofill state.
Its tracked identity contains session, workspace, Episode, Page, job ID, and a
scope key. A job is accepted only when all of the following are true:

- the ID is the exact accepted or recovered job ID;
- `job_type === "page_generate"`;
- `job.params.page_id` equals the selected Page ID;
- the selected Page still belongs to the captured Episode and scope.

Queued and processing jobs block Page/Panel/Scene mutation in the current Pages
screen. Completion refetches Pages and adopts only the refreshed target
`PageRecord`; no generated image is synthesized from the job response. Failed or
cancelled jobs release the block and display stable messages without raw provider
errors. A 404 or identity mismatch is fail-closed and requires reconciliation.
The parent screen also derives this lock directly from its current job-history
snapshot and the current Episode's Page IDs; it does not wait for a child effect
to announce an externally started Page job.

Before POST, a fresh job-history snapshot is captured. The POST is issued once.
Network, 5xx, timeout, or invalid-response failures may mean that the Backend
accepted the request. In that case the client performs read-only reconciliation:

1. refetch job history and the Page list;
2. accept only one active `page_generate` job for the exact Page;
3. if the refreshed Page has a different generated-image revision, treat it as
   completed;
4. otherwise keep an outcome-unknown state and require an explicit status check.

The status check never resends the POST. After a successful explicit check finds
no new exact job and no changed Page image, it may release the block so that a
later button press is a new user-authorized attempt. Multiple or mismatched
candidates remain blocked. The common 401 token refresh is unchanged; the first
request is rejected by authentication before mutation.

## Image-delivery boundary

The display first tries a valid HTTPS signed `cdn_url`, then the authenticated
Page export route, then one refreshed authorization header. It uses memory-only
caching keyed by session, workspace, Episode, Page, and generated timestamp.
Bearer tokens never appear in cache keys or query keys. An exhausted image load
shows a retry action that refetches Page metadata; it does not regenerate.

## Interfaces and affected files

- `apps/mobile/src/lib/api.ts`: additive `generatePage` wrapper.
- `apps/mobile/src/domain/pageGeneratedImageSources.ts`: scoped image sources.
- `apps/mobile/src/components/PageImageGenerationSection.tsx`: Page selection,
  readiness, single-flight mutation, exact polling/recovery, and image display.
- `apps/mobile/src/screens/PagesScreen.tsx`: ordered preparation callback and
  resource-operation blocking.
- `apps/mobile/src/screens/FoundationHomeScreen.tsx`: existing API base URL and
  current authorization header wiring.
- `apps/mobile/src/lib/i18n.ts` and Mobile tests.

No Backend, Web, migration, worker, or shared-contract file is in scope.

## Security and compatibility

- Organization IDs continue through the existing query helper.
- Page and job IDs are validated by existing generated Zod schemas.
- Mutation and status checks are single-flight and scope-captured.
- No optimistic Page image or job result is placed in the cache.
- No mutation is retried after a response-loss condition.
- Confirmed Pages are not regenerated until a separate explicit reopen feature
  is added.

## Test-first plan

1. API tests: POST path, organization scope, strict response parsing, and no
   retry for non-401 failures.
2. Image-source tests: HTTPS filtering, protected fallback, tenant/session/Page
   cache identity, and token exclusion.
3. Component tests: readiness boundaries, single-flight, ordered preparation
   stop, exact job identity, terminal handling, response-loss reconciliation,
   no automatic POST resend, scope changes, and image-load retry.
4. Screen/wiring tests: Page-generation operations block other Page editors and
   image authentication props reach Pages.
5. Full Backend/DB/Web/Mobile release gate, despite the Mobile-only diff.

## Sol/Terra delegation

The required repository orchestration skill is unavailable in this environment,
so its fallback is recorded here. Terra performed a read-only audit of the exact
clean worktree and identified the existing dirty-resolution order and the need
for Page-specific job state. Sol owns this design, all edits, integration review,
and release decision.
