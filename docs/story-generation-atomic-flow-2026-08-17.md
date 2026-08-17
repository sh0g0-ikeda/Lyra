# Story generation atomic flow design (2026-08-17)

## Purpose and scope

This change fixes the first three issues found in the story-generation audit without changing the public route names or the existing two-step user workflow.

1. Mobile page-skeleton generation creates only the skeleton by default.
2. Story-to-page autofill is rejected before job creation when the episode does not have a usable skeleton.
3. Legacy callers that explicitly request `apply_story_plan=true` compile and validate both artifacts before one atomic database commit. A failure, cancellation, or concurrent edit leaves the previous page graph untouched.

This change does not redesign page-image generation, entity/reference editing during page generation, or the Web page-generation transport. Those are separate audit findings.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: page skeleton generation and story application are explicit, separate user operations.
- Section 6: compiled episode plans are reviewed before persistence; graph locking, fingerprint recheck, commit gating, and transaction-scoped application prevent partial state.
- Section 8: model output is schema-validated and quality-gated before persistence.
- `docs/Lyra_StoryAI_SubSpec.md` sections 4-6 and 8: explicit application, story-to-page generation, quality gates, and required failure tests.

## Affected layers

- Mobile: two-step request flags and story-autofill readiness state.
- Route/Service: bounded input defaults and server-authoritative readiness preflight before enqueue.
- Worker: compile/checkpoint/commit ordering.
- Repository: graph lock and one transaction for skeleton replacement plus compiled-plan application.
- Domain: prepared skeleton/plan artifacts and deterministic fingerprint/remapping helpers.
- Ops: existing `generation_jobs.commit_started_at` is reused; no migration is required.

## Interfaces and state transitions

### Mobile two-step flow

- `Generate page skeleton` sends `apply_story_plan=false`.
- `Apply story to pages` is enabled only when the current page summary is loaded and every page has frames, matching panel/frame counts, and an editable status.
- Mobile readiness is advisory. The server repeats the check and remains authoritative.

### Server preflight

Before creating an `episode_story_autofill` job, the service reads the authorized episode planning context. It rejects missing episodes and unusable page graphs before writing a generation job or sending a queue message.

### Skeleton-only job

1. Compile, repair, and validate a skeleton without persistence.
2. Check cancellation.
3. Acquire the job commit marker with compare-and-set.
4. Persist the skeleton with the existing repository transaction.
5. Complete the job only when the commit marker exists.

### Combined compatibility job

1. Read the authorized skeleton source and current episode planning graph.
2. Compile, repair, and validate the skeleton in memory.
3. Build a virtual planning graph with temporary UUID page/panel identifiers.
4. Compile, audit, repair, and deterministically validate the story plan against that virtual graph.
5. Check cancellation.
6. Open one database transaction and lock work/chapter/episode, scenes, pages, panels, frames, entities, and entity states in the established order.
7. Re-read and compare the combined source fingerprint. A mismatch returns a conflict before deletion.
8. Acquire `commit_started_at`; cancellation wins if it was already requested.
9. Replace the skeleton, re-read the actual graph, remap compiled page identifiers by unique page number, validate panel orders/counts, and apply the plan with transaction-scoped repositories.
10. Commit all page/panel/frame/assignment changes together. Any exception rolls back the replacement and preserves the old graph.

No provider call occurs while database locks are held.

## Security and integrity

- Existing personal ownership / active organization membership checks remain mandatory at the locked transaction boundary.
- Client product IDs, generated IDs, or page contents are not trusted; all generated artifacts are bounded and validated.
- Fingerprints cover story source, scenes, entities, skeleton flags/count, and the prior page graph so concurrent edits fail closed.
- Cancellation and commit marker updates are compare-and-set operations; only cancellation or commit can win.
- Logs use sanitized errors and do not include prompts, tokens, or credentials.

## Test plan

RED tests are added before implementation for:

- Mobile sends `apply_story_plan=false` and disables story application without a usable skeleton.
- Server preflight performs zero job/queue writes for missing or unusable skeletons.
- Skeleton preparation validates but does not persist.
- Combined compiler failure and pre-commit cancellation perform zero skeleton writes for both fresh and overwrite modes.
- Atomic persistence retains the old graph when plan application or fingerprint validation fails.
- Commit marker CAS is required for completion and excludes cancellation.
- Existing standalone skeleton generation and standalone atomic story autofill continue to pass.

Final gates: targeted Vitest suites, backend type/build checks, Mobile tests/typecheck/lint/export, repository/invariant checks affected by the transaction contract, and Web lint/build smoke because shared API defaults change.

## Rollout compatibility

- Public endpoint paths and request fields are unchanged.
- Omitted `apply_story_plan` now defaults to `false`, matching the documented two-step flow.
- Explicit `true` remains supported through the atomic compatibility path.
- Existing queued jobs retain their stored explicit boolean and can be processed by the new worker.
- If the atomic dependency is unavailable, combined execution fails before any page persistence; it never falls back to the old partial-write sequence.
