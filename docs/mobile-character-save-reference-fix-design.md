# Mobile character save and reference availability fix

## Purpose and scope

- Remove the speech-profile editor from the mobile character screen.
- Align mobile character updates with the backend's optional update contract.
- Stop treating an unavailable capability check as an explicit server-side feature disable.
- Preserve existing backend data that is not edited by the visible mobile UI.

The backend routes, services, repositories, database, credit flow, and generation jobs are out of scope.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: character creation and reference-image workflow.
- Section 6: generation jobs and server-side generation controls.
- Section 8: bounded validation and stable user-facing errors.
- Section 10: focused tests plus mobile lint, typecheck, and build verification.

## Interface decisions

- Create payloads include the selected type, trimmed name, visible optional fields, and an empty
  speech profile for compatibility.
- Update payloads always include `expected_updated_at` and include only fields whose visible draft changed.
- Hidden `speech_profile` data is omitted from updates, so the backend retains its current value.
- Visible structured fields are bounded and filtered to the backend character schema before they are
  sent. In particular, clothing description is limited to the backend's 500-character maximum.
- Reference generation is blocked only when the capability endpoint explicitly returns
  `enabled: false`. Loading or request failure does not masquerade as a feature disable; request
  failure remains visible through the existing actionable error UI.
- The deployed legacy API currently interprets
  `/entities/reference-generation-availability` as an entity ID and returns a specific UUID 422.
  The mobile client treats only that legacy response as "capability unknown" and lets the existing
  generation endpoint remain authoritative.
- A production API predating the capability endpoint routes the fixed path through `:id` and
  returns `VALIDATION_ERROR` with `id must be a valid UUID`. Mobile recognizes only that exact
  compatibility response and defers authority to the existing generation endpoint.
- Character custom-choice input and clothing descriptions use the backend's current length
  limits. Structured-field updates remove unsupported legacy keys before submission.

## Security

- Authentication, authorization, organization capability checks, credit checks, and generation
  capacity remain enforced by the backend.
- No secret, raw provider error, storage key, or credential handling changes.
- The mobile client does not bypass a server-side disable: the generation endpoint remains the
  authority and rejects disabled generation.

## Test plan

1. Add a UI contract test that rejects rendered speech-profile controls.
2. Add payload tests for minimal create, changed-field update, and hidden speech-profile retention.
3. Add generation-availability policy tests for explicit disable versus unknown status.
4. Run focused tests first, then mobile test, mojibake check, lint, typecheck, contract check, and
   Android export.

## Delegation

- Terra read-only task 1: compare mobile entity payloads with backend Zod/service contracts.
- Terra read-only task 2: trace reference-generation availability through mobile, API, and runtime
  feature flags.
- Sol retains design, implementation, integration, security review, and final verification.
