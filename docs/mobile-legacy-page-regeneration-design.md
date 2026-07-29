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
7. Match Web with one stable primary action labelled `ページ生成`. Do not derive
   its label or visibility from `generated_image`; the backend decides whether the
   request is an initial generation or an update of the current result.
8. Keep the generation section expanded, place its actions first, and keep it
   visible for every selected page.
9. A confirmed page remains the sole exception: show `再編集` beside the disabled
   generation action, reopen it to `editing`, then return to the same save-and-
   generate workflow. This preserves the backend's confirmed-page protection.
10. After job completion, invalidate page, panel, and frame data so the newest
    generated image replaces the previous display.
11. If a user has typed into the unsaved new-panel form, require `作成` before
    generation. The atomic API updates persisted panel IDs and cannot safely
    invent the matching frame for a new panel.
12. Save dirty page, persisted-panel, and frame drafts before page confirmation
    so confirmation cannot hide or discard pending editor state.
13. Treat an initially observed completed job as completion and invalidate the
    displayed resources; fast jobs must not leave the previous image cached.

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
