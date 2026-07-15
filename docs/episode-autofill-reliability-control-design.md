# Episode Autofill Reliability and Control Design

## 1. Purpose and scope

This change makes the episode-wide "apply story" workflow fail less often and
gives the user a safe way to stop it. It addresses the production failure of
job `475a247d-111c-4ca7-ad24-b534a949232c`, where all detail compilation and
two audit passes completed, but ten remaining audit findings caused the whole
result to be discarded.

In scope:

- adaptive page packing instead of a fixed three-page chunk size;
- field-level review and repair without rewriting unaffected panels;
- blocking only unresolved `error` findings, while retaining `warning`
  findings as telemetry;
- cooperative cancellation before persistence starts;
- user-facing stop, cancelled status, progress, and local history removal;
- safe audit telemetry without story text or provider prompts.

Out of scope:

- changing page-image generation or entity-reference generation;
- changing credit prices (episode autofill is free);
- physically deleting server-side job audit records from the browser;
- cancelling after the persistence commit gate has started.

Spec basis: `docs/Lyra_Unified_Spec_v4.md` sections 4, 6, 8, 9, and 10.

## 2. Compatibility strategy

The existing continuity V3 implementation remains available for one release.
The new path is selected by feature flags and uses the same compiler result and
page/panel persistence contracts. A rollback changes configuration rather than
database contents.

New flags:

- `EPISODE_PAGE_PLAN_ADAPTIVE_PACKING_ENABLED`
- `EPISODE_PLAN_INLINE_REPAIR_ENABLED`
- `EPISODE_STORY_AUTOFILL_CANCELLATION_ENABLED`

The migration is additive. Existing `queued`, `processing`, `completed`, and
`failed` rows remain valid; `cancelled` is added as a terminal status.

## 3. Execution order

1. Load and authorize the episode planning context.
2. Validate frame/panel consistency and repair layout metadata in memory only.
3. Create a full-episode beat ledger.
4. Estimate each page's structured-output cost from its panel capacity.
5. Compile the largest consecutive page packs that fit the safe output budget.
   A page is never split. Small and normal episodes compile in one or two calls.
6. Combine and schema-validate the draft against known page, panel, scene, and
   entity identifiers.
7. Run one review call over the complete draft. The response contains findings
   and explicit page/panel field patches.
8. When the first review contains an `error`, apply its declared fields to the
   in-memory draft exactly once. IDs, page order, panel order, and panel counts
   are immutable.
9. Run deterministic continuity checks and one final audit pass over the
   once-repaired draft. A repair proposed by this verification is not applied,
   and a third audit pass is never started.
10. Reject only unresolved `error` findings. Record warnings as safe telemetry.
11. Re-fetch the episode and compare its fingerprint.
12. Atomically enter the commit gate if cancellation has not been requested.
13. Persist page and panel changes. Cancellation is no longer accepted once this
    step begins, avoiding partial application.

## 4. Adaptive packing contract

Packing is a pure domain decision. It receives ordered pages and an output-token
budget, estimates page cost from panel count, and returns consecutive non-empty
packs. It must preserve page order and include every page exactly once.

The estimate intentionally leaves headroom below the provider's configured
maximum output tokens. If one page exceeds the target budget, that page forms a
single pack instead of being split or rejected.

## 5. Review and repair contract

The structured response contains:

- `accepted`;
- findings with `code`, `severity`, `message`, and known `page_ids`;
- page patches identifying `page_id` and an allowlist of changed fields;
- panel patches identifying `page_id`, `panel_order`, and an allowlist of
  changed fields.

Static Zod validation is followed by context validation. Unknown IDs, unknown
panel orders, duplicate patch targets, and attempts to change immutable fields
are rejected. The merge code copies only allowlisted fields. LLM output is never
written directly to the database.

The repair budget is bounded per execution: at most one field-level patch set is
applied and at most two audit passes are started. Each pass may still use the
compiler client's bounded transport retry for a retryable provider failure. If
the final verification reports an `error`, the complete draft is discarded
without persistence. This avoids stochastic repair loops and keeps provider cost
and latency bounded.

Safe telemetry records stage duration, pass number, finding code/severity, and
page identifiers. It excludes story text, dialogue text, prompts, API keys, and
raw provider errors.

## 6. Cancellation state machine

`generation_jobs` gains additive nullable timestamps:

- `cancel_requested_at`
- `cancel_requested_by`
- `cancelled_at`
- `commit_started_at`

Transitions:

- `queued -> cancelled`: immediate and idempotent;
- `processing -> processing(cancel requested)`: the worker stops at the next
  boundary and finalizes `cancelled`;
- `processing -> applying`: an atomic commit gate sets `commit_started_at` only
  when no cancellation is pending;
- `applying/completed/failed/cancelled`: cancellation is rejected or treated as
  an idempotent terminal response.

The cancel route is authenticated, ownership/workspace scoped, rate limited,
and body-free. A cancelled queued SQS delivery is acknowledged without running
the compiler. In-flight provider cancellation is best effort; already consumed
provider tokens cannot be recovered.

## 7. Web behavior

- Active episode-autofill jobs show a red outlined stop button.
- After requesting cancellation, the UI shows "Stopping" and disables repeat
  requests.
- During the commit stage, stop is disabled and the UI explains that saving has
  started.
- `cancelled` is a distinct terminal status, not a failure.
- Terminal jobs can be removed from the browser's tracked history. This does not
  delete the server audit row.
- Progress uses real stage/chunk data; it does not claim completion when work has
  only started.

## 8. Security and tenancy

- Job lookup and cancellation use the authenticated user and active organization
  scope; a job ID alone grants no access.
- Migration SQL is additive and parameterized repository queries remain the only
  persistence implementation.
- Cancellation cannot bypass the commit gate or mutate another tenant's job.
- Audit logs contain identifiers and classifications only, not user story data.
- No credit mutation is introduced because episode autofill is a free text task.

## 9. TDD and verification

Tests are added before implementation for:

- adaptive packing order, budget boundary, and oversized single-page behavior;
- warning-only review acceptance and unresolved-error rejection;
- field-level patch preservation and unknown-ID rejection;
- queued cancellation, processing cancellation, commit-race rejection, tenancy,
  and idempotency;
- worker no-op for cancelled SQS deliveries and cancellation between stages;
- web stop/delete/status rendering and API request shape;
- migration/status/invariant compatibility.

Release verification follows Spec section 10: Vitest and Bun, migration and
invariant checks, backend build, web lint/build, Playwright smoke, one-off
migration, API/worker rollout, queue inspection, readiness, and log review.

## 10. Sol/Terra task split

Sol owns architecture, state transitions, security decisions, integration,
review, rollout, and final verification. Read-only Terra explorers inspect
(a) compiler/service contracts and (b) job/UI/deployment contracts. Their output
is advisory; Sol reviews it before editing. File changes remain in the main
worktree to avoid overlapping writes.

## 11. Integration hardening before rollout

The pre-implementation review identified four integration boundaries that must
be closed before enabling cancellation in production:

1. Job lookup and cancellation accept the active organization ID and verify an
   active membership before repository access. Personal requests remain scoped
   to `user_id` plus `organization_id IS NULL`.
2. Stale recovery finalizes a processing job with a pending cancellation as
   `cancelled`, rather than leaving it active forever or rewriting it as a
   failure.
3. The generated episode plan is applied through one PostgreSQL transaction.
   The transaction locks the episode planning graph, re-checks the original
   fingerprint under those locks, and writes page, panel, and entity assignment
   changes atomically. A concurrent user edit therefore waits and is never
   silently overwritten by an older generated draft.
4. New cancellation response fields are optional in the browser contract for
   one rolling-deployment window. Missing legacy fields must not be interpreted
   as an active cancellation or commit state.
5. Browser-tracked job IDs are namespaced by the authenticated session and the
   active personal or organization workspace. The personal workspace reads the
   legacy key once for rolling compatibility, while organization workspaces
   never inherit another scope's local history.
6. Deterministic duplicate and continuity findings are included in the same
   complete-episode review brief as model findings. This avoids a separate
   three-page repair loop while preserving a non-LLM safety check.
7. The OpenAI strict JSON schema and the Zod contract share the same nullable
   fields and maximum lengths. A provider-valid response must therefore remain
   application-valid before contextual ID validation is applied.
8. Atomic persistence is selected whenever the new controlled execution path
   defers writes, independently of the continuity feature flag. This prevents a
   partial write if cancellation is enabled while continuity V3 remains off.

Cancellation is disabled by default until the additive migration and both
worker and API revisions are healthy. The production rollout order is:

1. apply migration `024` and run deployment invariants;
2. deploy workers with cancellation disabled;
3. deploy the API with cancellation disabled;
4. enable cancellation for workers and API, then confirm readiness and logs;
5. deploy the web client last;
6. verify personal and organization stop flows, stale recovery, queue depth,
   and that no job remains active after cancellation.

Adaptive packing and inline repair do not depend on the migration and may be
rolled back independently with their feature flags.
