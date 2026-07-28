# Mobile character selection, layout visibility, and rate-limit recovery design

## Purpose and scope

This frontend-only change improves three mobile workflows:

- Put "New character" inside the character selector instead of presenting a separate competing action.
- Hide manual page-layout template and frame-editing controls on mobile while preserving saved frame data and backend generation contracts.
- Keep the authenticated workspace usable when a background `/api/me` refresh is rate-limited, and make initial rate-limit recovery respect the server wait period.

Backend routes, rate-limit rules, persistence, billing, generation jobs, and image delivery are unchanged.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: character creation and page generation are primary product flows.
- Section 4: authenticated session state must remain correctly scoped.
- Section 6: current saved page inputs remain authoritative for generation.
- Section 8: raw backend errors must not reach users.
- Section 9: transient availability failures must remain recoverable.
- Section 10: mobile and release verification gates.

## Affected layers and interfaces

- Mobile Characters screen: character picker options and create/edit mode transition.
- Mobile Pages screen: visibility only for template/frame editing sections and layout recovery actions.
- Mobile App bootstrap: distinguish background refresh failure from missing initial session data.
- Mobile API client: retain bounded numeric `Retry-After` metadata on `ApiError`.
- Mobile session recovery: show the remaining wait and disable retry until it expires.

Existing entity, page, panel, frame, generation, authentication, and organization API payloads remain unchanged.

## State transitions

1. Selecting "New character" clears the selected entity through the existing dirty-state guard and opens a clean create draft.
2. Selecting an existing character keeps the current edit flow.
3. Layout and frame records continue loading for generation consistency, but manual layout controls are not rendered on mobile.
4. If `/api/me` refresh fails while cached session data exists, the main tabs remain mounted.
5. If initial `/api/me` loading receives 429, the recovery screen displays the bounded server wait time and enables retry only after it expires.
6. Recovery-screen logout bypasses stale editor guards because editor screens are not mounted there, then clears tokens and the React Query cache through the existing logout flow.

## Security

- Authentication tokens, query cache, and workspace selection still clear on confirmed logout.
- Organization scope and backend ownership checks are unchanged.
- `Retry-After` accepts only bounded integer seconds; arbitrary response text is not displayed.
- No raw provider or infrastructure message is added to the UI.

## Test strategy

1. Add failing character UI contract tests for the selector option and removal of the separate button.
2. Add failing feature-visibility tests for mobile layout controls and recovery actions.
3. Add failing app bootstrap coverage proving cached session data survives a 429 refresh error.
4. Add failing API and recovery-component tests for bounded `Retry-After`, countdown text, and disabled retry.
5. Run targeted mobile tests, typecheck, lint, mojibake check, full Vitest, API inventory/parity checks, Android export, CI, and an EAS development APK build.

## Sol/Terra delegation

Terra performs a read-only independent investigation of rate-limit, logout, and query-cache behavior. Sol owns design, TDD, implementation, integration, security review, and release verification.
