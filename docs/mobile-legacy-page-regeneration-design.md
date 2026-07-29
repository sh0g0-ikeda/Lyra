# Mobile legacy page regeneration compatibility

## Purpose and scope

Allow Mobile users to edit a previously generated page and generate a replacement
image against both the current API and the deployed transitional API. The change is
limited to Mobile capability detection, save orchestration, labels, and tests. It
does not change backend routes, generation workers, credit accounting, persistence
contracts, or Web behavior.

## Spec basis

- Unified Spec section 2: users edit page and panel inputs before image generation.
- Unified Spec section 6: regeneration uses the current saved inputs and creates a
  new generation job.
- Unified Spec section 8: API errors remain validated and raw provider errors are
  not exposed.

## Contract mismatch

The current Mobile flow requires:

- `GET /api/pages/:id/generation-readiness`
- `POST /api/pages/:id/save-and-generate`

The deployed transitional backend predates both routes, but supports the underlying
page, panel, assignment, and frame save routes plus
`POST /api/pages/:id/generate`. Consequently Mobile either disables generation
because readiness is unavailable or receives 404 from the atomic route.

## Design

1. Prefer the current readiness and atomic save-and-generate routes.
2. Treat only HTTP 404 or 405 from these two capability routes as an unsupported
   API generation. Other errors remain visible and block generation.
3. When readiness is unsupported, allow the generation button and rely on the
   legacy generation service's existing validation, authorization, active-job, and
   credit checks.
4. When atomic save-and-generate is unsupported, save dirty page settings, the
   selected panel and assignments, and frames through their existing authenticated
   Mobile API methods, then call the legacy page generation route.
5. If any save fails, do not enqueue generation. A partial legacy save remains
   visible and retryable; do not attempt a rollback that could overwrite newer
   edits.
6. Do not fall back for validation, stale-resource, conflict, permission, rate
   limit, or server errors.
7. Label the action `ページを再生成` when the selected page already has a generated
   image.

## Security and billing

- Existing auth and organization scope are reused on every request.
- Backend generation validation and transactional credit charging remain
  authoritative.
- The fallback does not infer credit settlement or retry a chargeable request after
  a known successful response.
- Provider errors and storage identifiers are not exposed.

## Test plan and delegation

Write failing tests first for atomic success, 404/405 fallback ordering, save
failure, non-capability errors, and readiness capability detection. Run targeted
tests, the complete Mobile suite, typecheck, lint, mojibake, API contract,
inventory, and Web parity checks.

Terra performs a read-only historical route review. Sol owns design, tests,
implementation, integration, and final verification.
