# Mobile Job Management Implementation Design

## Purpose and scope

Implement `MOB-JOB-001`, `MOB-JOB-002`, `MOB-JOB-003`, `MOB-JOB-005`, and the
foreground-recovery portion of `MOB-JOB-004` from
`docs/mobile_completion_gap_spec.md`.

This change adds a server-authoritative, workspace-scoped job history to Mobile.
Push notification registration and delivery were added in the later
`docs/mobile-push-notification-design.md` slice.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` sections 4, 5, 6, 7, and 8: authenticated
  ownership, organization membership, generation-job recovery, transactional
  credits, and safe output.
- `docs/mobile_completion_gap_spec.md` sections `MOB-JOB-001` through
  `MOB-JOB-005`.

## Affected layers

- Route: `src/routes/jobs.ts`
- Service: `src/services/job/**`
- Repository and migration: `GenerationJobRepository` and migration `027`
- Mobile: API boundary, query keys, job status UI, and Account jobs section

## Contracts and security controls

- `GET /api/jobs` accepts bounded cursor, limit, status, and type filters. The
  server filters personal jobs to `organization_id IS NULL`; organization jobs
  require an active member role with `view_work`. Active jobs sort first, then
  use `(created_at DESC, id DESC)` as the stable cursor order.
- `GET /api/jobs/:id` keeps its existing route and response fields. It gains an
  optional `organization_id`; absent means personal scope only. The returned
  `error_message` is a safe compatibility message, never the persisted raw
  error. New error metadata uses stable code/message key/retryable/support ID.
- Queued jobs are canceled immediately. Processing jobs persist a bounded,
  authenticated `cancel_requested` marker and workers observe it at safe stage
  boundaries. A provider call already in flight is allowed to return, but the
  worker checks again before publishing its result. The cancellation transition,
  credit refund, usage event, and audit record are transactionally idempotent.
- History hide is per user in a dedicated logical-hide table. It never deletes
  generation jobs, credit ledger rows, or organization audit evidence.
- The cancellation refund path is idempotent and must remain coordinated with
  the job state transition and existing credit-ledger constraints.
- Mobile reads the paginated server list as authority. Stored job IDs remain a
  supplementary local hint only; transient/offline failures retain already
  rendered job state.

## Test plan

1. Add failing backend unit/route tests for scope, cursor ordering, safe error
   serialization, queued cancellation, processing cancellation request,
   worker checkpoints, completion races, refund idempotency, and logical hide.
2. Add failing Mobile API/query-key/UI tests for organization scoping, safe
   contract parsing, actions, and foreground refresh behavior.
3. Verify focused tests, full Mobile tests, typecheck, lint, mojibake scan,
   backend tests, backend build, and migration invariants.

## Delegation

The original slice had no Terra delegation. The processing-cancellation
amendment may be delegated as one bounded Backend packet covering the migration,
job repository/service/route, worker checkpoints, and focused tests. Sol owns
the shared Mobile contract, UI integration, security review, and final gates.

## Processing-cancellation amendment

Purpose: close the remaining `MOB-JOB-002` difference without pretending that a
provider request can always be interrupted immediately.

Persistence and API contract:

- A new migration adds nullable cancellation-request metadata to
  `generation_jobs`; request identity is server-derived and never accepted from
  a Mobile body.
- `POST /api/jobs/:id/cancel` keeps personal/organization capability scope.
  Queued jobs become `canceled` immediately. Processing jobs atomically record a
  cancellation request and return a safe job response that says the request is
  pending. Repeated calls are idempotent.
- Terminal completion wins only if no cancellation request is present. A worker
  cancellation checkpoint locks the same balance/job order as credit
  consumption and finalization, transitions the job to `canceled`, and refunds
  the consumed amount at most once.

Worker contract:

- Page, entity-reference, episode-story-autofill, and episode-page-skeleton
  workers check immediately after claim and before each persisted publication
  boundary.
- An in-flight provider call is not forcibly aborted. On return, a checkpoint
  prevents generated output from being attached to the page/entity/story.
- A canceled worker result is acknowledged rather than retried. Existing
  recovery and stale-job logic must treat `canceled` as terminal.

Security and verification:

- Tenant predicates and `generate` capability checks remain in the existing
  route/service/repository boundary.
- Raw provider errors, cancellation metadata, ledger internals, and credentials
  are not exposed.
- Focused tests must prove processing request idempotency, no publication after
  a request, completion/request race behavior, and one refund. Backend build,
  migration checks, Mobile contract tests, and job UI tests are required before
  integration is complete.
