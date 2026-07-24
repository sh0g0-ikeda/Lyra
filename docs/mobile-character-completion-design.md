# Mobile character completion design

## Purpose and scope

This slice closes `MOB-ENTITY-002` through `MOB-ENTITY-005` without changing
backend generation behavior. Mobile keeps the backend structured-field
contract, but removes AI-only identifiers and advanced anchor controls from the
user interface, makes clothing details free text, limits the active preview to
one candidate, and explains generation blockers before the user taps generate.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` entity workflow, tenant authorization,
  generation jobs, credits, bounded validation, and authenticated assets
- `docs/mobile_completion_gap_spec.md` `MOB-ENTITY-002` through
  `MOB-ENTITY-005`

## Data and security contract

- Existing hidden `prompt_supplement`, anchor, silhouette, distinguishing,
  proportion, and unknown structured fields remain in local state and are
  preserved when visible fields are saved.
- Aliases remain user-editable and serialize to
  `character_identity.aliases`.
- Mobile never accepts or displays a raw S3 key, reference token, or entity
  state ID. A generated or imported candidate token is held only in memory and
  sent through the typed confirmation contract.
- Exactly one active candidate is shown. A newly completed generated preview
  replaces the previous import preview in the UI; it does not use an older
  generated preview as generation input.
- Confirmation sends the same candidate as both the one-item selected list and
  primary candidate. Existing confirmed references are not reinterpreted as S3
  keys.
- Confirm success clears transient candidate state and invalidates entity and
  reference queries. Confirmed image URLs include the reference-set revision to
  prevent stale cache reuse.

## Generation blockers

The Mobile blocker list covers the facts available before the request:
permission, saved entity, non-empty name, supported type, active upload/import,
active preview job, and current personal/organization credit balance. Backend
authorization, job uniqueness, and credit locking remain authoritative. A
client-side balance is advisory and is never used to grant or consume credit.

## Testing

Tests are written first for single-candidate selection, one-item confirmation,
and blocker derivation. Existing upload tests cover progress/cancel/retry.
Verification includes focused Vitest, full Mobile typecheck, lint, mojibake
check, and the complete Mobile suite.

## Delegation

No Terra delegation is used for this screen because the policy, payload
preservation, and UI are tightly coupled in `CharactersScreen`; active Terra
workers own disjoint billing and organization files.
