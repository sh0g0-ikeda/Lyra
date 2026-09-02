# Mobile/Web story save and hierarchy release design

## Purpose and scope

This release restores story saving on Web, iPhone, and Android, makes stale-edit
recovery actionable on mobile, keeps Android hierarchy actions above the system
navigation area, and exposes contextual `Add chapter` / `Add episode` actions in
the hierarchy tree. It also carries the already completed mobile page-editor
visual hierarchy work into the next store binaries.

This change does not loosen authentication, ownership, organization scoping, or
optimistic-concurrency protection. It does not change story-generation,
billing, credit, or provider behavior.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: work, chapter, episode, and story
  editing are primary Web/mobile workflows.
- Section 3: HTTP validation stays in Routes, workflow decisions stay in
  Services, persistence concurrency stays in Repositories, and client state/UI
  stays in Web/Mobile.
- Section 6: stored editor inputs and concurrent edits must not be silently
  overwritten.
- Section 8: bounded story payload validation remains server-authoritative.
- Section 10: closest tests, Web/Mobile build gates, and release artifacts must
  be verified before submission.

## Confirmed causes

### Story revision precision

PostgreSQL stores `TIMESTAMPTZ` values written by `NOW()` with microsecond
precision. The Node `Date` conversion and API `toISOString()` response expose
only milliseconds. The current Work/Chapter/Episode update SQL compares the
client token to the database value with exact timestamp equality. A stored
value such as `.123456` is therefore returned as `.123`, and an otherwise fresh
first save can fail as `RESOURCE_STALE`.

The repository will compare the database revision at millisecond precision and
will advance every successful story-resource revision to a millisecond-aligned,
strictly newer value. Row-level update serialization plus the strictly
increasing value preserves stale-write rejection even when two requests arrive
within the same wall-clock millisecond.

### Mobile stale recovery

The mobile `Reload latest state` action currently calls `fetchQuery` while the
global cache may still be fresh for 15 seconds, so it can return the same stale
record without a network request. The generic `Retry` action only invalidates
queries; it neither retries the save nor clears the mutation/stale state. The
save button then remains disabled.

Mobile will use a forced episode fetch for stale recovery. The dedicated stale
notice will own the recovery actions so the same conflict is not also rendered
as a generic retry error:

1. `Reload latest state` fetches from the API, replaces the local draft and
   revision with the returned episode, and clears the stale/mutation error.
2. `Retry with current input` first fetches the latest episode revision, keeps
   the user's draft, then explicitly submits that draft against the fresh
   revision. A second concurrent edit still returns `RESOURCE_STALE`; there is
   no unguarded overwrite.
3. A successful save writes the returned episode into the query cache and
   hydrates the local fields from that authoritative response, so the next save
   uses its new revision immediately.

### Web versioned update contract

Several Web Work/Chapter/Episode update call sites still use the pre-versioned
API signature and omit `expected_updated_at`. The typed Web API adapter will
require an explicit revision option and serialize it into the request. Page
settings remain on their existing non-versioned strict schema.

### Android hierarchy bottom area and discoverability

The full-screen hierarchy uses absolute overlays whose bottom padding is a
fixed spacing token. It does not explicitly add the runtime bottom safe-area
inset, and Android title entry has no keyboard-avoidance behavior. Menu actions
can therefore sit against the gesture/home area.

The menu and title overlays will include the measured bottom inset, and Android
title entry will use `KeyboardAvoidingView` behavior `height` (iOS remains
`padding`). Existing full-screen safe-area edges remain enabled.

Expanded work branches will show a separate, at-least-44-point `Add chapter`
row. Expanded chapter branches will show the equivalent `Add episode` row.
They reuse the existing create-title intent, API payload, selection, and query
invalidation behavior. Existing overflow-menu actions remain available. The
inline actions are hidden without edit capability and disabled while a
hierarchy mutation is pending.

## Interfaces and state

- Backend request/response JSON remains compatible: clients continue sending
  `expected_updated_at`; responses continue returning `version` and
  `updated_at`.
- Repository writes retain ownership/organization predicates and add only the
  normalized revision predicate/write expression.
- Web update methods take `{ organizationId, expectedUpdatedAt }` rather than an
  ambiguous positional organization argument.
- Mobile hierarchy creation/deletion continues using the existing endpoints;
  only discoverability, safe-area layout, and accessibility labels change.

## Security and data integrity

- Authentication and tenant authorization are unchanged.
- Stale edits remain rejected with HTTP 409; no route accepts a missing
  revision and no automatic unguarded overwrite is introduced.
- The explicit mobile retry obtains a fresh server revision immediately before
  resubmission. A race after that fetch remains protected by the repository.
- No SQL user input is interpolated, and no secret, billing, credit, file, or
  provider contract is changed.

## TDD and verification plan

1. RED: repository tests require millisecond-normalized comparison and a
   strictly increasing millisecond-aligned update expression for work, chapter,
   episode, and story-owned episode side effects.
2. RED: mobile tests require authoritative cache replacement on save, a forced
   network reload, meaningful current-draft retry, and stale errors excluded
   from generic retry UI.
3. RED: Web API contract tests require `expected_updated_at` for every versioned
   Work/Chapter/Episode/Entity update while keeping Page settings unversioned.
4. RED: hierarchy tests require visible contextual add rows, read-only hiding,
   dynamic bottom inset, 44-point targets, and Android/iOS keyboard behavior.
5. Run closest Vitest suites, backend tests/build, Web lint/build and smoke,
   Mobile tests/typecheck/lint/contracts/export checks, then an independent
   review.
6. Resolve inherited release-gate failures, build Android AAB and iOS update
   binaries, submit both, and verify their external build/submission states.

## Sol/Terra ownership

Sol owns this design, concurrency choice, integration, release decisions, and
final review. Terra performs read-only audits for mobile save recovery, Web
payloads, hierarchy safe-area behavior, and final validation. Terra does not
change secrets, billing, production data, or store state.
