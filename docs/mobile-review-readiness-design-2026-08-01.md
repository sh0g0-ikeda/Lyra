# Mobile review readiness design (2026-08-01)

## Purpose and scope

Make the existing mobile client suitable for device verification without changing Lyra's persisted data or generation pipeline.

- Restore image and episode export download flows against the current authenticated backend contract.
- Keep recoverable failures visible and actionable, but render error notices with a neutral warning treatment instead of red. Treat stale/not-found job records as an empty state.
- Add a compact Japanese/English switch at the top of screens so it is available before reaching Account settings.
- Preserve the existing fail-closed store billing behavior. The purchase panel remains hidden until the server verifier, product allowlist, and store credentials are enabled; this change does not create non-functional review-only purchase controls.

Out of scope: database changes, generation jobs, credit accounting, store product configuration, backend deployment flags, and changes to the web client.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: selected-page image and PDF/ZIP export.
- Section 5: authenticated private file delivery.
- Section 7: billing must fail closed and server verification remains authoritative.
- Section 8: stable, user-safe error presentation.
- Section 10: mobile/build and contract verification gates.

## Affected layers and interfaces

- Mobile UI: `Screen`, error notices, job cards, and Pages export controls.
- Mobile API adapter: parse the canonical episode export status schema instead of the retired compatibility shape.
- Mobile file transfer: download through authenticated Lyra endpoints, then open the operating-system save/share sheet.
- No Route, Service, Repository, Domain persistence, Infrastructure, Worker, migration, or web contract changes.

The export status interface remains `{ job_id, status, progress, error, download_ready, timestamps }`. Download authorization remains on `GET /api/exports/:jobId/download`; signed storage URLs are not added to status payloads or caches.

## Security and failure behavior

- Continue sending the current ID token only to Lyra's configured API origin.
- Preserve organization scoping on image and export download endpoints.
- Keep user input out of storage paths through the existing filename normalization.
- Do not hide actionable failures. Retry controls and safe messages remain, using a non-red warning palette.
- A 404 for a polled stale job is treated as an absent job card, avoiding a misleading review-time error.
- Store billing stays server-authoritative and disabled unless both client and backend configuration are complete.

## Test-first plan

1. Update API contract and export-card tests to the canonical export status and authenticated download-by-job-ID flow; confirm they fail before implementation.
2. Add tests for non-red error notice defaults and not-found job suppression.
3. Add accessibility and interaction tests for the global language switch, including headerless screens.
4. Run focused mobile tests, TypeScript, lint, mobile diagnostics/export, shared contract tests, and the repository gates applicable to an unchanged backend.

## Sol/Terra task split

Sol owns the design, implementation, integration, final safety review, and release decision. Terra performed read-only audits of export contracts, review-safe error presentation, and billing/language reachability. No Terra agent owns writes or integration decisions for this slice.
