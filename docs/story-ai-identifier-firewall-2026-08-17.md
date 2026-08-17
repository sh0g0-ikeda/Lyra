# Story AI identifier firewall design (2026-08-17)

## Purpose and scope

Prevent an episode story-autofill plan from reaching the persistence gate with an
entity, entity-state, or scene identifier that is not part of the already authorized
episode planning context. Correct the Web job-card copy that currently describes a
generic story-autofill failure as an image-save failure.

This change does not alter compiler prompts, provider retry limits, routes, API
payloads, workers, SQS, generation job state, credits, repositories, migrations, or
the atomic persistence transaction.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` section 6: unknown identifiers are rejected,
  semantic review remains bounded, and the complete plan is persisted atomically.
- `docs/Lyra_Unified_Spec_v4.md` section 8: structured LLM output is validated and
  quality-gated before persistence; raw provider errors are not user-visible.
- `docs/Lyra_StoryAI_SubSpec.md` sections 5, 6, and 8: entity assignments and
  dialogue speakers must be context-supported, fallback must not promote unrelated
  entities, and malformed output requires regression coverage.

## Affected layers and interfaces

- Service: add a pure identifier firewall for `EpisodePagePlanSuggestion` and call
  it after initial compiler repair and after each audit repair.
- Web: classify a failed generation job by its stable `job_type` / `message_key`
  instead of re-parsing the generic English error string.
- Tests: add pure service, PageService integration, and Web error-copy regressions.

Inputs and outputs remain unchanged. The persistence input remains the complete,
validated episode plan and the existing transaction remains the only write gate.

## Identifier firewall behavior

The firewall derives allowlists only from `EpisodePagePlanContext`, which was loaded
through the existing user/organization authorization scope. It verifies:

- every source scene belongs to the current episode;
- every dialogue speaker and panel assignment belongs to the authorized context;
- every state belongs to the exact assigned entity, not merely another entity in
  the same episode;
- an entity is not assigned twice to the same panel.

It never performs a global entity lookup and never substitutes an arbitrary known
entity for an unknown one. When an identifier-bearing candidate bundle is invalid:

- invalid `sourceSceneIds` reverts as a complete field to the trusted fallback;
- `dialogue` and `entities` revert together to the trusted fallback because their
  speaker/visibility semantics are coupled;
- if the trusted fallback is not itself valid, the operation fails before the
  commit gate.

For initial compilation, the trusted fallback is the existing deterministic plan
built from the authorized context. For an audit repair, it is the pre-audit plan
that has already passed the same firewall. Existing strict validation remains the
final backstop. Existing bounded audit and deterministic quality gates decide
whether a reverted repair is still usable; unresolved blocking errors are not
silently persisted.

## Security and failure controls

- Tenant scope is inherited only from the authorized context; no cross-work lookup.
- Unknown identifiers are not logged. Only aggregate reversion counts may be logged.
- No partial writes: all new checks run before `beginCommit` and the existing atomic
  transaction is unchanged.
- No new provider retry is introduced, avoiding duplicate cost and another long
  audit cycle.
- The Web displays actionable, operation-specific copy without raw internal errors.

## TDD and verification

Write failing tests first for unknown entity IDs, mismatched entity/state pairs,
duplicate assignments, trusted-fallback failure, preservation of unrelated valid
audit text, and zero persistence-gate calls on unrecoverable input. Add Web tests
showing story-autofill failures do not use image-generation copy while page-image
jobs retain their current wording.

Run targeted Vitest first, followed by backend build, full tests, Web lint/build,
database invariants, and relevant Playwright smoke. Production rollout order is
worker first, then API if the shared backend image requires it, then Web. Inspect
queue depth, worker health, readiness, the canary story-autofill result, and logs
before completing rollout. No native build is required unless the final diff changes
native configuration, dependencies, or Mobile runtime code.

## Terra delegation

- Terra owns the disjoint Web error-copy implementation and tests.
- Terra performs a read-only release/runbook audit.
- Sol owns the identifier-firewall design, service integration, final review,
  commits, PR, and production operations.
