# Episode Autofill Final Audit Repair Design

> Superseded by `docs/episode-autofill-semantic-gate-design.md`. This document
> describes the former three-audit design and is retained only as change history.

## Purpose and scope

Fix `episode_story_autofill` jobs that fail after the second whole-episode audit even
when that audit returned valid field-level repairs. Both normal audit passes must be
able to apply their own repairs before the plan is saved. When the second pass needs
repair, a third verification-only audit must confirm that no blocking semantic issue
remains. This change does not alter page packing, detail prompts, job charging,
tenancy, cancellation, or the atomic persistence boundary.

## Specification basis

- Unified Spec section 3: keep orchestration in services and persistence in repositories.
- Unified Spec section 6: preserve the generation job lifecycle and worker isolation;
  unresolved error findings block persistence, while validated field-level repairs may
  be applied before the atomic save.
- Unified Spec section 8: validate structured LLM output and quality-gate it before save.
- Unified Spec section 9: keep bounded provider calls and preserve failure isolation.

## Affected layers and contract

- Service: `PageService` applies a schema-validated audit repair after either audit pass.
- Service: the common path remains one or two audit calls. Only a second-pass repair
  uses one final verification call; that verification cannot return another repair.
- Domain helper: existing repair allowlists continue to constrain page IDs, panel orders,
  and changed fields.
- Repository, Route, Worker, Web, Mobile, billing, and migrations remain unchanged.
- A blocking audit without a usable repair remains a failure and writes no page changes.

## Security and integrity

- Repair targets must belong to the compiled episode and existing panel orders.
- Every blocking issue must be covered by a repair targeting one of its affected pages.
- The repaired plan is normalized and validated against the current episode context.
- A final verification audit must contain no blocking error. Its repairs are ignored and
  any remaining error rejects the plan, preventing an unverified semantic repair from
  being persisted.
- Persistence remains one atomic commit after compilation and cancellation checkpoints.

## Test plan

1. Reproduce a first audit repair followed by a second audit repair and verify the final
   repair is persisted only after a clean third verification audit.
2. Verify a final blocking issue without repair still fails before persistence.
3. Verify a blocking issue that remains after the third audit fails before persistence.
4. Run PageService tests, then the repository release verification gates.

## Terra delegation

Terra performs read-only reviews of compiler/persistence and job-lifecycle failure paths.
Sol owns production diagnosis, design, implementation, integration, and deployment.
