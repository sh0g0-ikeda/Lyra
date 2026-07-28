# Mobile page switch state synchronization design

## Purpose and scope

Fix two frontend-only page switching regressions:

- Switching pages must not register the previous page's editor values as unsaved input while the next page's panel and frame queries are still loading.
- A generated image selected from the authoritative page list must remain selected when a supporting readiness, panel, or frame request returns an error.
- Image source notifications must not create a parent/child rerender loop after a generated image resolves.

This change does not modify backend routes, payloads, persistence, image authorization, generation jobs, or billing.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: users review and generate pages from saved page, panel, and frame inputs.
- Section 5: PostgreSQL remains authoritative and production images use authenticated or short-lived delivery.
- Section 8: provider and infrastructure failures must not leak raw details.
- Section 10: release verification gates.

## Affected layers and interfaces

- Mobile domain policy: distinguish a synchronized editor draft from transient values belonging to the previous resource.
- Mobile Pages screen: apply synchronization-aware dirty flags to page, panel, and frame drafts.
- Mobile Pages screen: clear a selected page only when the page detail itself is authoritatively missing or belongs to another episode, not when a supporting child query fails.
- Mobile image viewer: keep source-change callbacks stable and ignore repeated notification of the same resolved source.
- Tests: pure policy boundaries and source-level page recovery contract.

The existing `updateSelection`, dirty-resolution dialog, page list query, image candidate builder, and API methods remain unchanged.

## State transition

1. The current page's synchronized drafts are checked before selection changes.
2. After selection changes, resource IDs no longer match the last hydrated IDs, so transient old values are not reported as user edits.
3. Page, panel, and frame effects hydrate when their new server snapshots become available.
4. Dirty tracking resumes only after each draft is synchronized to the selected resource.
5. Supporting query failures remain actionable errors but cannot clear a page that is still present in the page list.
6. Repeated notification of the same resolved image source leaves viewer state unchanged.

## Security

- Existing authentication headers, organization scope, signed image fallback URLs, and ownership checks remain intact.
- No error details or credentials are added to the UI.
- Dirty confirmation remains mandatory for genuine synchronized user edits.

## Test strategy

1. Add failing unit tests for synchronization-aware dirty reporting.
2. Add a failing recovery contract test proving supporting 404s cannot clear page selection.
3. Add a failing image-viewer test proving the source callback stays stable after rerender.
4. Run page selection, dirty-state, image source, query recovery, and editor revision tests.
5. Run Mobile typecheck, lint, mojibake check, full Vitest, Android export, and CI.

## Sol/Terra delegation

Terra performs a read-only independent root-cause review of page selection, image sources, and dirty-state timing. Sol owns the design, tests, implementation, integration, security review, and release verification.
