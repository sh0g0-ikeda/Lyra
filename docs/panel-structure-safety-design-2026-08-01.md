# Panel structure safety boundary

Date: 2026-08-01

## Purpose and scope

Add an opt-in Page-scoped command for Mobile panel append, delete, and reorder.
The command must leave the existing Panel, Panel entity assignment, Page,
generation-job, prompt, worker, credit, and SQS contracts unchanged.

This slice does not expose the Mobile controls yet and does not replace the
existing low-level Panel routes used by Web. Mobile wiring is a separate PR
after this Backend boundary passes the release gates.

The surrounding Balloon write internals are hardened in the same slice because
the new command cannot be atomic in isolation if an older Balloon write can
reintroduce a deleted Panel order. Existing Balloon HTTP bodies and responses
remain unchanged.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` sections 2, 3, 4, 6, 8, and 10.
- `docs/Lyra_StoryAI_SubSpec.md`: at most eight Panels per Page.
- Existing generation readiness requires a non-empty one-to-one Panel/Frame
  set before Page generation.

## Additive HTTP contract

`PUT /api/pages/:id/panel-structure`

The bounded request contains the currently observed ordered Panel IDs and one
operation:

- `append`: append one empty Panel.
- `delete`: delete one named Panel, but never the final Panel.
- `reorder`: provide every current Panel ID exactly once in the desired order.

`expected_panel_ids` is an optimistic-concurrency snapshot. A mismatch returns
409 before writes. The response contains only the authoritative ordered Panel
IDs, optional created Panel ID, resulting Frames, the template used for a count
change, and bounded Balloon-reference impact counts. Existing request and
response bodies remain unchanged.

## Transaction and persistence rules

One PostgreSQL transaction performs the complete command:

1. Resolve the authorized Page and Episode.
2. Acquire the shared Episode generation-admission advisory lock.
3. Re-resolve and lock the Page, then reject `confirmed` / `generating` Pages.
4. Reject active Page generation for the Page and active story-autofill or
   page-skeleton generation for the Episode.
5. Lock current Panels and compare their ordered IDs with
   `expected_panel_ids`.
6. Apply the requested Panel mutation with a 1..8 Panel invariant.
7. Keep Balloon `panel_order_reference` attached to the same logical Panel;
   deleting the referenced Panel clears only that reference.
8. For append/delete, replace Frames with the deterministic default template
   for the new count. For reorder, preserve geometry and style while linking
   Frames to the requested reading order; reject an already inconsistent
   Panel/Frame graph rather than guessing.
9. Update only the structural keys in `pages.layout_config`, preserving story
   metadata and unrelated keys.
10. Return the committed authoritative structure.

Existing Balloon create, update, and automatic replacement take the same Page
row lock before writing. They compare the ordered Panel IDs observed by the
Service with the locked current order and revalidate `panel_order_reference` in
that transaction. A concurrent structure change therefore either runs after the
Balloon write and remaps it, or runs first and makes the stale Balloon write
fail with 409 before mutation.

Any failure rolls back Panels, Frames, Balloon references, and layout metadata
together. A lost response is reconciled by refetching; clients must not blindly
repeat an append or delete.

## Interfaces and layers

- Route: authentication, organization `edit_work`, UUID/body validation,
  response mapping, and audit metadata.
- Service: operation-shape validation and deterministic template selection.
- Repository: authorization recheck, admission/Page/Panel locks, active-job
  check, conditional snapshot, transaction, and authoritative result.
- Domain: bounded operation and result types only.
- Infrastructure/Worker/Mobile/Web: unchanged in this slice.

## Security and compatibility

- Personal ownership or active organization membership is rechecked inside the
  transaction; knowing a Page or Panel ID is insufficient.
- The Route still requires organization `edit_work` capability.
- All identifiers are UUID-validated, lists are capped at eight, duplicates are
  rejected, and SQL uses parameters.
- No migration, provider call, secret, file operation, credit mutation, prompt,
  queue message, or generated-image mutation is introduced.
- Existing Panel and Balloon routes and persisted Panel/Frame/Balloon shapes are
  unchanged. Balloon writes gain only internal locking and conditional checks.

## Test-first plan

1. Validator/Service tests: append boundary 0/8, final-Panel delete, unknown or
   duplicate IDs, reorder set equality, and default-template selection.
2. Route tests: auth/capability path, bounded parsing, request mapping, stable
   response mapping, and audit action.
3. Repository tests: ownership scope, lock ordering, active-job rejection,
   stale snapshot rejection, atomic append/delete/reorder, Frame behavior,
   Balloon remapping, and rollback.
4. Full release gate: Vitest, Bun, Backend build, API inventory and contract
   drift, fresh migrations/invariants, Web lint/build, Playwright smoke, Mobile
   typecheck/lint/dependency checks and both OS exports.

## Sol/Terra delegation

The completed read-only Terra audit established the unsafe current boundaries:
non-atomic Panel/Frame updates, missing Balloon remapping, max-count drift, and
no stale-write guard. Sol owns this design, implementation, integration review,
and release decision. No additional parallel implementation is delegated because
the transaction and contract files form one tightly coupled ownership slice.
