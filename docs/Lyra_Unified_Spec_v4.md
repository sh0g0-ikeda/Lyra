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
7. Export selected pages as images or PDF.

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

Organization roles are `owner`, `admin`, `billing`, `editor`, and `viewer`.
Billing authority is separate from editing authority. Public routes are explicitly
limited to health/readiness, verified Stripe webhooks, static web assets, and the
organization-invitation acceptance flow where applicable.

## 5. Persistence and tenancy

PostgreSQL is the system of record. Works are either personal or associated with an
organization workspace. Organization-scoped API requests carry an organization ID,
which is validated against membership before data access.

Images are stored by opaque S3 keys. User input is not interpolated into storage
paths. Database responses may contain stable image metadata, while production image
delivery uses authenticated export or short-lived CloudFront signed URLs.

## 6. Generation jobs

Long-running page, entity, page-skeleton, and story-autofill work is represented by
`generation_jobs`. Active jobs use `queued` or `processing`; terminal jobs use
`completed`, `failed`, or `cancelled`. Active-job uniqueness prevents duplicate work
for the same resource. SQS visibility, provider timeout, retry classification,
recovery, cancellation, and credit refund must remain coordinated. Job lookup and
cancellation are scoped to personal ownership or active organization membership.

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

## 7. Credits and billing

Text AI operations are free. Entity preview/import analysis and page generation use
the configured credit costs. Credits are deducted transactionally with row locking
and a ledger record. Failed chargeable jobs are refunded idempotently.

Personal credits and organization shared credits are separate. The active workspace
determines which balance is displayed and charged. Stripe webhook events, after
signature verification, are the authority for subscription and purchased-credit
grants. Browser return URLs never grant credits.

## 8. Input and output safety

- Request bodies use bounded Zod schemas.
- SQL uses parameter binding.
- Uploaded images are restricted by MIME type and size.
- LLM structured output is schema-validated and quality-gated before persistence.
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
