# Lyra Unified Specification v4

## 1. Status and authority

This document is the maintained index of Lyra's current implementation contract.
The historical v4 file was not present in the repository or its Git history when
this index was reconstructed on 2026-07-13. Where this document and executable
behavior differ, the following sources are authoritative until the discrepancy is
reviewed and this document is updated:

1. SQL migrations in `migrations/`
2. Route validation schemas and service interfaces in `src/`
3. Unit and integration tests in `tests/`
4. Browser contract tests in `apps/web/e2e/`

Applied migrations must never be edited. Contract changes require a new migration,
tests, and an update to this document.

## 2. Product boundary

Lyra is an authenticated manga-production application. A user can create works,
chapters, episodes, optional scenes, entities, page plans, panels, frames, dialogue,
and generated images. Personal work and organization work share the same production
pipeline but use separate ownership and credit scopes.

The primary user flows are:

1. Create a work, chapter, and episode.
2. Write the episode story and optionally add scene context.
3. Create and confirm character reference images.
4. Generate a page skeleton, then apply the story to editable panel fields.
5. Review entities, situation, composition, camera, background, and dialogue.
6. Generate a page image from the current saved inputs.
7. Export selected pages as images, PDF, or ZIP.

## 3. Architecture

- `src/routes`: HTTP input, authentication middleware, validation, response mapping.
- `src/services`: business workflows and transaction boundaries.
- `src/repositories`: parameterized PostgreSQL access.
- `src/domain`: types, constants, schemas, and domain errors.
- `src/infrastructure`: OpenAI, AWS, Stripe, and local adapters.
- `worker`: asynchronous generation job execution.
- `apps/web`: React browser client.

Routes must not implement provider calls or credit arithmetic directly. Services
depend on ports, and repositories own persistence details.

## 4. Authentication and authorization

Production authentication uses Cognito JWT verification. Protected routes require
authentication and resource authorization. A resource lookup must be scoped through
the requesting user's personal ownership or active organization membership; knowing
an ID is never sufficient authorization.

Account deletion stores a keyed one-way identity tombstone before anonymizing the
Cognito subject. Provisioning must reject a subject whose deletion is processing,
pending recovery, or completed, so an unexpired token cannot recreate the Lyra user.
After deletion starts, database guards reject new personal content roots while the
durable deletion workflow finishes.

Organization roles are `owner`, `admin`, `billing`, `editor`, and `viewer`.
Billing authority is separate from editing authority. Public routes are explicitly
limited to health/readiness, verified Stripe webhooks, static web assets, and the
organization-invitation acceptance flow where applicable.

## 5. Persistence and tenancy

PostgreSQL is the system of record. Works are either personal or associated with an
organization workspace. Organization-scoped API requests carry an organization ID,
which is validated against membership before data access.

Mobile panel append, delete, and reorder use an additive Page-scoped structure
command. The command conditionally compares the client's complete ordered Panel-ID
snapshot, shares the Episode generation-admission lock, and updates Panels, Frames,
Balloon order references, and structural layout metadata in one transaction. A Page
retains 1–8 Panels after deletion, while append may repair an empty draft Page. Count
changes select the deterministic default Frame template; reorder preserves Frame
geometry and style. Existing low-level Panel routes and persisted Panel, Frame,
Balloon, prompt, job, queue, worker, and credit contracts remain unchanged.
Balloon create, update, and automatic replacement share the Page row lock and
recheck the complete ordered Panel-ID snapshot plus order-reference bounds before
writing, so they cannot recreate a stale reference during a structure command.

Images are stored by opaque S3 keys. User input is not interpolated into storage
paths. Database responses may contain stable image metadata, while production image
delivery uses authenticated export or short-lived CloudFront signed URLs.

Episode export artifacts are asynchronous, owner-scoped records with a bounded
lifetime. Their storage keys are derived from authenticated scope, episode, and job
identifiers rather than filenames. Applying their persistence migration alone does
not enable queue dispatch, artifact creation, or download routes. Processing uses a
bounded lease token and heartbeat; only the current lease may update progress or
write a terminal state, and an expired lease may be reclaimed without allowing the
older worker to overwrite its replacement.

The export worker reads only the immutable page snapshot stored with the job. Each
source image is limited to 20 MiB, all sources together to 64 MiB, and the produced
artifact to 128 MiB. Production object reads use bounded HEAD plus ETag-conditioned
Range GET validation for MIME, size, range, and image signature. Network failures,
HTTP 429, and provider 5xx responses are retryable; invalid keys, images, or
artifacts fail with stable sanitized errors. PDF and ZIP bytes are deterministic
for the same persisted snapshot, and artifacts are private, encrypted, and written
only to the server-derived job key. These worker and storage contracts do not by
themselves enable queue polling, API routes, or downloads.

Episode export runtime wiring is independently gated by
`EPISODE_EXPORT_ENABLED`, which defaults to false. When enabled, authenticated
create/status/download routes require personal ownership or active organization
membership with export capability. Creation commits the job and outbox before a
best-effort dispatch to `SQS_QUEUE_URL_EXPORT`; status reads and a bounded periodic
runner recover undispatched rows. Export messages carry only a version and export
job ID, and a dedicated poller never shares the generation queue or credit path.
Completed, unexpired artifacts are delivered only through an HTTPS URL lasting no
longer than five minutes or the remaining artifact lifetime. Expiry cleanup deletes
the exact server-derived key before marking it deleted and is safe to retry.

Chapter and episode deletion is serialized with generation and episode-export
admission at the episode boundary. The authorized target, descendant episodes, and
pages are locked and blockers are rechecked in the deletion transaction. Queued or
processing generation/export work, a completed export artifact that has not been
deleted, or a persisted generated page image blocks deletion with a sanitized
conflict. Scope-external targets remain not found. This fail-closed boundary prevents
workers, retries, credits, job history, and opaque S3 objects from being orphaned by
the story foreign-key cascade. A future durable asset-deletion workflow may replace
the generated-file blocker, but a database cascade alone must never imply S3 deletion.

Native push device tokens are encrypted with authenticated encryption before
persistence and are located by a separately keyed deterministic digest. Registration
is unique per user installation, and logout removal is scoped by both user and
installation. Persistence and internal services alone do not enable registration
routes, device permission prompts, or APNs / FCM delivery.

Push notification outbox rows snapshot only completed or failed generation-job
events with no cancellation request or cancellation timestamp, and reference
same-user token registrations without copying ciphertext. A failed state never
overrides cancellation evidence for notification eligibility. Account deletion
serializes with the token registry and cancels unsent deliveries before removing
tokens. Its write guard allows a previously active job to reach a terminal state
but rejects reactivating a terminal personal job after deletion starts. Explicit
terminal settlement takes the token-registry lock before the job-row lock, then
commits the terminal state, retry-count event snapshot, outbox, and deliveries in
one transaction. Retrying a failed job invalidates its unsent failed deliveries
in the same statement. Lease-based delivery and provider dispatch must still be
wired and verified before push delivery is enabled.

Account deletion is independently gated by `ACCOUNT_DELETION_ENABLED`, which
defaults to false. The authenticated API accepts no user, identity, subscription,
or storage identifier from the client. It blocks a sole active organization owner
and active personal generation/export jobs, requires explicit acknowledgement for
personal subscriptions, store billing, and assets, then checkpoints exact Stripe
subscription cancellation, exact personal S3 object deletion, personal-data
anonymization, and Cognito disable/delete. A dedicated bounded recovery runner
reclaims stale or retryable requests with a fencing token and backoff.
The claim transaction rechecks acknowledgements against subscriptions, store
billing, and assets that may have appeared after preview. Completion removes raw
subscription and object-key checkpoints while retaining only the keyed identity
tombstone required to prevent reprovisioning.
Each attempt starts at most 25 external steps and stops scheduling new external
work after 15 seconds; a normal continuation releases its claim without increasing
the failure backoff. Cognito and S3 commands also have a 30-second abort timeout.

Personal works, personal upload records, push tokens, balances, and direct
identifiers are removed. Organization works, organization billing, organization
audit/usage data, and statutory or anti-fraud billing ledgers remain attached only
to an anonymized user anchor. Store and Stripe events received after deletion
starts are deduplicated as provider records but cannot restore personal credits or
plan entitlements.

## 6. Generation jobs

Long-running page, entity, page-skeleton, and story-autofill work is represented by
`generation_jobs`. Active jobs use `queued` or `processing`; terminal jobs use
`completed`, `failed`, or `cancelled`. Active-job uniqueness prevents duplicate work
for the same resource. SQS visibility, provider timeout, retry classification,
recovery, cancellation, and credit refund must remain coordinated. Job lookup and
cancellation are scoped to personal ownership or active organization membership.
New episode/page generation jobs and failed-job retries acquire the same
transaction-scoped episode admission lock used by story deletion, then revalidate
the authorized target before entering an active state.

Generation and regeneration both create a new result from the current saved inputs.
A previous generated page image is not an implicit image reference. Confirmed entity
reference images are explicit character-consistency inputs.

Story-to-page autofill plans beat ownership across the complete episode before
expanding the existing pages. Detail compilation uses adaptive, consecutive page
packs sized by estimated structured-output cost; it must not use a fixed three-page
split. A page is never split between packs, and a pack may contain the full episode
when it fits the safe output budget.

The combined draft is reviewed for cross-page repetition, dialogue placement,
chronology, page handoffs, entity assignment, and editable visual fields before any
page or panel content is persisted. Review repairs are field-level patches: page and
panel identity, order, and panel count are immutable. Unknown identifiers or invalid
patch targets are rejected. Semantic review uses at most two audit passes and applies
each pass's validated field-level repairs once; it must not recursively audit or
repair. The first audit is required. If the second audit remains unavailable after
its structured-output retry, the already repaired draft proceeds to the deterministic
gate instead of being discarded. After bounded repair, schema, identifier, structure,
and deterministic cross-page duplicate errors block persistence. Residual semantic-
only findings are retained as safe telemetry and do not discard otherwise usable
content. The plan uses each existing page's frame count as its story capacity and
carries scene character-state notes such as costume and injury through the global
continuity brief.

Episode autofill supports cooperative cancellation while queued or before the
atomic persistence gate. Once `commit_started_at` is set, cancellation is rejected
and the complete generated plan is written in one PostgreSQL transaction. The
transaction locks the authorized episode planning graph, rechecks the input
fingerprint, and applies page, panel, and entity assignment changes together so a
concurrent edit is not silently overwritten and a partial plan cannot be exposed.

Cancellation request metadata is paired, cancellation and commit start are mutually
exclusive, and a cancelled job carries ordered request, cancellation, and completion
timestamps. New writes are protected before legacy rows are validated. Production
invariants must report zero legacy violations before a later migration validates the
constraints or cancellation is generalized to additional job types.

Generation-job history hiding is a per-user display preference. It never deletes a
job, changes its status, cancels work, or mutates credits. Any future history write
must first authorize the job through personal ownership or active organization
membership.

## 7. Credits and billing

Text AI operations are free. Entity preview/import analysis and page generation use
the configured credit costs. Credits are deducted transactionally with row locking
and a ledger record. Failed chargeable jobs are refunded idempotently.

Personal credits and organization shared credits are separate. The active workspace
determines which balance is displayed and charged. Stripe webhook events, after
signature verification, are the authority for subscription and purchased-credit
grants. Browser return URLs never grant credits.

Mobile store billing remains disabled unless its server verifier, product allowlist,
credentials, and explicit feature flag are configured. When enabled, verified Apple
or Google evidence is authoritative and may affect only personal credits. Raw
StoreKit JWS values and Google Play purchase tokens are never persisted; keyed
digests identify purchases, provider events, and credit-ledger mutations behind
independent uniqueness barriers. Applying the persistence migration alone does not
enable a purchase route or grant credits.

## 8. Input and output safety

- Request bodies use bounded Zod schemas.
- SQL uses parameter binding.
- Uploaded images are restricted by MIME type and size.
- Image-prompt compilers treat explicit ages as authoritative, use neutral
  age-appropriate visual language for children, and do not invent person or camera
  details that conflict with the stated age.
- Direct image uploads use short-lived, single-use records bound to the user,
  optional organization and entity, MIME type, size, and a server-generated
  temporary storage key. Only a token hash is persisted.
- LLM structured output is schema-validated and quality-gated before persistence.
- Authenticated AI-generated content reports use a fixed kind and reason vocabulary,
  accept only an optional opaque UUID for correlation, and emit a privacy-minimized
  operational receipt without attaching prompts, generated content, images, email,
  tokens, or provider responses.
- Authenticated organization safety reports require active `view_work` membership,
  accept only the organization UUID plus a fixed target kind and reason, and emit a
  privacy-minimized receipt without accepting workspace content, target-user IDs,
  email, prompts, URLs, or other tenant data.
- Raw provider errors, credentials, connection strings, and stack traces are not
  returned to end users.
- External calls have bounded timeouts and retry only retryable failures.

## 9. Availability contract

`GET /healthz` is process liveness and must not depend on PostgreSQL or providers.
`GET /readyz` is service readiness and checks PostgreSQL connectivity. A readiness
failure returns a generic HTTP 503 response without infrastructure details.

The API must remain responsive while generation work is queued. Workers can scale
independently of the API. Queue depth, oldest message age, job duration, failure
rate, credit refunds, database capacity, and provider errors are operational signals.
Episode export has a separate queue, worker process, visibility timeout, outbox
recovery, and artifact-cleanup loop so document assembly cannot consume image
generation capacity.

## 10. Verification gate

Every release must pass:

- Vitest and Bun test entrypoints
- PostgreSQL migration and deployment-invariant checks
- backend TypeScript build
- frontend lint and production build
- Playwright auth and authenticated-console smoke tests

Production deployment additionally requires runtime configuration validation,
migrations as a one-off task, healthy API readiness, worker rollout health, queue
inspection, and post-deploy log review.

## 11. Related documents

- `docs/Lyra_StoryAI_SubSpec.md`
- `docs/runtime-contract-readiness-design.md`
- `README.md`
- `migrations/`
