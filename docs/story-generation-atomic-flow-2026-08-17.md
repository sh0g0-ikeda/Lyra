# Story generation two-step safety design (2026-08-17)

## Purpose and scope

This change fixes the first three Story AI findings with a deliberately small,
two-step workflow.

1. Page-skeleton generation creates and saves only the skeleton.
2. Story-to-page autofill cannot be queued until an authorized, usable skeleton
   exists.
3. Cancellation, skeleton replacement, and skeleton-job completion have one
   atomic persistence boundary so partial or contradictory state is not exposed.

The public route and request field names remain available. The legacy
`apply_story_plan=true` input is accepted but normalized to skeleton-only. Existing
queued `true` jobs are also processed as skeleton-only and complete with
`story_plan_applied=false`. Users apply story content explicitly through the existing
second action.

This change does not modify page-image generation, entity/reference mutations,
the existing standalone episode-story-autofill compiler, billing, credits, or any
database migration.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2 defines skeleton generation followed by
  explicit story application as the primary flow.
- Section 6 requires coordinated job state, cancellation, current saved inputs,
  fingerprint checks, and atomic plan persistence.
- Section 8 requires bounded, validated model output before persistence.
- `docs/Lyra_StoryAI_SubSpec.md` sections 4-6 require explicit application and
  quality-gated story-to-page output.

## Affected layers

- Mobile: explicit skeleton-only requests, retry normalization, and an advisory
  readiness reason for the second action.
- Route/Service: request normalization and server-authoritative readiness preflight
  before a story-autofill job or queue message is created.
- Worker: prepare, cancellation checkpoint, and one atomic skeleton commit.
- Repository: job-row commit gate, source-fingerprint recheck, skeleton replacement,
  and terminal job update in one PostgreSQL transaction.
- Domain: canonical source fingerprinting shared without a Repository-to-Service
  dependency.
- Ops: no migration; existing `generation_jobs.commit_started_at` is reused.

`PageService`, `EpisodePlanPersistenceRepository`, and the standalone
`episode_story_autofill` transaction are not extended for skeleton generation.
Virtual page IDs and combined skeleton/story remapping are intentionally excluded.

The current default long-job capacity of one active job per user also prevents a
skeleton job and story-autofill job from starting together in normal operation.
If that capacity is raised above one, a shared per-episode lock across both job
types must be added first. Until then, the commit fingerprint still rejects stale
output rather than publishing mixed state.

## Interfaces and state transitions

### Request normalization

- New Mobile and Web callers send `apply_story_plan=false`.
- The API continues to accept omitted, `false`, and `true` values.
- The enqueue service stores `apply_story_plan=false` regardless of the requested
  legacy value, so direct service callers cannot restore the combined path.
- The queued response and completed job result report
  `story_plan_applied=false` truthfully.
- Retry sends literal `false`; a legacy queued `true` is treated as skeleton-only by
  the worker.
- The synchronous fallback follows the same skeleton-only behavior and does not
  require a story-plan service.

### Skeleton job

```text
queued
  -> claim processing
  -> compile, repair, validate [no page writes; cancellation allowed]
  -> cancellation checkpoint
  -> SERIALIZABLE PostgreSQL transaction
       lock/CAS generation job and set commit_started_at
       lock work/chapter/episode, scenes, pages, panels, frames, balloons, entities
       re-read authorized skeleton source
       compare source fingerprint
       replace/create page skeleton
       set the same job to completed with result metadata
     commit
```

If cancellation wins before the transaction, no page is written. If the commit
gate wins, cancellation is rejected until the short transaction completes. Any
exception after the gate but before commit rolls back the marker, page graph, and
terminal update together. A redelivered message cannot reclaim a completed job.

Provider calls occur before the database transaction. Personal ownership or active
organization membership is rechecked through the transaction-scoped story
repository before any replacement.

### Story autofill job

Before enqueue, the authorized episode planning context must contain 1-24 pages.
Every page must be editable, have a positive frame count, and have a panel count
matching its frame count. Missing, generating, or confirmed pages are rejected
before creating a job or sending SQS.

The existing standalone story-autofill worker remains the only path that applies
story content. Skeleton-job success and story-autofill failure therefore have
separate job IDs and terminal states.

## Security and integrity

- Existing route authentication and `edit_work` authorization remain mandatory.
- Repository reads are scoped by personal ownership or active organization
  membership.
- SQL remains parameterized.
- Model output is bounded, repaired, and validated before the commit transaction.
- The source fingerprint prevents an old AI result from replacing pages after the
  story, scenes, entities, existing page graph, or balloons changed.
- Both operations remain zero-credit text jobs; no credit or refund path changes.
- Persisted and user-facing errors remain sanitized.

## TDD plan

Tests are changed before production code and must fail for the intended contract:

1. omitted/false/true requests all enqueue and return skeleton-only behavior;
2. direct enqueue with `true` stores `apply_story_plan=false`;
3. a legacy queued `true` never calls `PageService` and completes with false metadata;
4. retry always sends literal false;
5. prepare-time or pre-commit cancellation writes no pages;
6. transaction failure after skeleton replacement rolls back both pages and job;
7. successful commit persists pages and completed job together;
8. changed source fingerprint writes neither pages nor completed state;
9. no skeleton, missing frames, frame/panel mismatch, generating pages, or confirmed
   pages produce zero autofill job and queue writes;
10. the Mobile second action is disabled with a visible reason until the best-effort
    readiness conditions are met.

Unit tests cover routing, service normalization, worker state, transaction ordering,
source-change rejection, and SQL contracts. The CI suite runs before migrations, so
this bounded change does not add a new full-schema PostgreSQL fixture; concurrent
cancel/source-edit behavior remains a required staging smoke before deployment.

Final verification includes targeted tests, full backend tests/build/invariants,
Mobile tests/typecheck/lint/contracts/mojibake/export, Web lint/build, and diff-scope
review.

## Rollout

1. Verify there are no active `episode_page_skeleton` jobs and the relevant SQS
   queue is drained.
2. Deploy the new worker first so legacy queued/requested `true` cannot enter the old
   sequential path.
3. Deploy the API.
4. Verify a skeleton-only job, cancellation before commit, and a separate story
   autofill job in production logs without exposing prompts or credentials.
5. Release Mobile only after backend verification.

Old clients remain able to generate skeletons and use the existing explicit story
application action. Automatic combined execution is intentionally retired because
preserving it safely requires the larger virtual-graph implementation rejected by
this design review.
