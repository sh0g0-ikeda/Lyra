# Episode Autofill Semantic Gate Design

## Purpose and scope

Prevent a complete, structurally valid story-to-page plan from being discarded only
because a repeated LLM audit changes its semantic judgement. This change is limited
to the inline episode-plan review path used by "Apply whole episode". It does not
change the HTTP contract, database schema, credit handling, job ownership, or page
image generation.

## Spec basis

`docs/Lyra_Unified_Spec_v4.md` requires cross-page review before atomic persistence,
field-level repairs with immutable page/panel identity, rejection of invalid targets,
and deterministic validation of the repaired plan.

## Runtime flow

1. Compile the complete episode draft.
2. Run semantic audit pass 1 across every page.
3. If pass 1 reports errors, require and apply its bounded field-level repairs.
4. Run semantic audit pass 2 against the repaired draft.
   If pass 2 remains unavailable after its built-in structured-output retry, continue
   to the deterministic gate instead of discarding the pass-1 repairs.
5. If pass 2 supplies error repairs, apply those repairs once. Do not invoke a third
   semantic audit and do not recursively repair.
6. Normalize and validate identifiers, page count, panel count, panel order, entity
   scope, and repair targets after each repair application.
7. Re-run deterministic cross-page duplicate checks locally. Remaining deterministic
   errors block persistence. Remaining semantic-only findings from pass 2 are logged
   as warnings and do not discard the complete plan.
8. Persist the resulting episode atomically through the existing repository path.

## Security and tenancy

No authorization or tenancy boundary changes. Existing context-scoped page, panel,
scene, and entity identifiers remain authoritative. Unknown identifiers and invalid
repair targets still fail before persistence. Credit and cancellation behavior are
unchanged.

## Tests

- A second semantic audit may return a valid repair; it is applied and the plan is
  saved without a third model call.
- A residual semantic-only error without another repair does not discard a
  deterministic-valid plan.
- A malformed or unavailable second audit does not discard a deterministic-valid
  plan that was already repaired by pass 1.
- A deterministic duplicate that remains after bounded repair still blocks all
  persistence.
- An invalid second-pass repair target is still rejected.

## Delegation

`multi_agent_v1` is unavailable in this environment. The Terra task packet is kept as
a local checklist: inspect only `PageService`, its continuity helpers, and focused
tests; do not change routes, repositories, billing, migrations, web, mobile, or cloud
configuration. Sol owns integration, final review, and deployment verification.
