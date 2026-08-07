# Page list production schema repair — 2026-08-07

## Purpose and scope

Restore the mobile and web page-list read path for production records without
changing pages, ownership, organization membership, or saved user input. The
production API log shows the page repository requesting
`pages.story_source_scene_ids` before the production database contains that
column.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` sections 3, 4, 5, 8, 9, and 10: persistence
  belongs behind the repository/service boundary; reads remain tenant-scoped;
  server details are not exposed to clients; production changes are verified.

## Interface and data change

Add one forward-only, idempotent migration after the existing production
migration sequence. It adds the three page-story metadata columns when absent
and backfills them from the already persisted `layout_config` JSON. Existing
rows keep their current page content and creation order.

## Security and rollout

The migration has no user-supplied SQL, uses no secrets in source, and does
not widen access. First verify the migration history from an ECS task using
the API task role; then run the migration under the migration lock. Confirm
the exact failing API path returns HTTP 200 afterward and inspect the task
exit status and logs.

## Test plan

Add a regression test proving the forward repair migration is retained even
when the older, differently named production migration is already recorded.
Run that focused test, the migration test suite, TypeScript build, and then
the production migration task plus an API-log verification.

## Delegation

Terra performed a read-only trace of the mobile page-list API path. Sol owns
the schema repair, operational execution, review, and verification.
