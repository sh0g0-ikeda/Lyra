# Organization collection pagination compatibility

## Scope and authority

Restore the deployed `2debe8c` member, invitation, usage and audit-log page
contracts, without changing workspace listing, mutations, billing or migrations.
This implements Unified Spec §§3–5, 7–8 and 10. Existing candidate capability,
organization-status and response metadata guards remain authoritative.

## Design before implementation

Routes parse optional `limit` (1–100) and endpoint-specific opaque `cursor`.
No query keeps the existing collection response shape; explicit pagination adds
`next_cursor`. Keep the deployed `{v:1,k,sort,id}` base64url cursor exactly, with
strict fields, endpoint kind, UUID and canonical UTC timestamp checks. A cursor
alone is invalid. Domain code owns the codec, services authorize each read,
repositories own bounded keyset SQL and aggregate SQL.

Member/invitation pages require `manage_members`; usage requires `view_usage`.
Audit pages retain full logs for authorized audit roles and billing-prefix-only
logs for billing roles. Cursor contents never grant membership or tenant access.
Every page query filters its organization before applying the boundary and
`limit + 1`. Order remains `created_at DESC, id DESC`. PostgreSQL timestamps can
have microseconds absent from JavaScript Date: resolve a matching cursor anchor
inside the same tenant to recover its exact timestamp before comparison. If an
anchor is absent, use the validated timestamp boundary, never another tenant's
record. IDs break timestamp ties.

The UTC current-month summary uses all events from month start through (but not
including) next month start, independently of the visible page, cursor or the
legacy 200-row event cap. SQL aggregation orders numeric totals numerically.
No-query usage also uses this aggregate, fixing the existing truncated total.
Old array-returning service methods remain for existing callers and CSV behavior.

Add a separate collection pagination repository capability with fail-closed
configuration checks, matching the current workspace pagination port pattern.
Do not silently fall back to unbounded reads or page-derived aggregates.

## Verification

Freeze the exact production Mobile schemas with source commit and SHA-256.
Exercise real HTTP routes against PostgreSQL with more than 200 usage/audit rows,
limit boundaries, timestamp ties and microsecond timestamps, old Mobile parsing,
all four page types, invalid/wrong-kind cursors, foreign tenant and membership
revocation, billing-only audit visibility, and whole-month aggregate invariance.
Retain strict current response validation and metadata filtering. Add focused
codec, authorization and route regressions; run backend build and existing org
unit suites. No production or provider mutation is part of this work.

## Verification results

- Before implementation, all four route regression cases returned 200 for an
  invalid cursor; the new validation tests failed as expected.
- 73 focused tests pass, including four real PostgreSQL HTTP integration cases.
  These traverse 209 usage records, 205 audit records, and member/invitation
  boundaries through the frozen deployed Mobile schemas. They cover exact ties
  at PostgreSQL microsecond precision, UTC period bounds, numeric summary order,
  legacy summary independence, role filtering, inactive membership and tenant
  isolation.
- Backend TypeScript build and generated Mobile contract check pass.
- The production schema source is SHA-256
  `55136e342f0bfdf983785d7861b4f65c1e9eff6c668f17726d139160136f9185` at
  `2debe8c:apps/mobile/src/domain/apiSchemas.ts`; the fixture copies its exact
  organization collection declarations and dependencies.
