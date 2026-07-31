# Mobile Page style / provenance settings design

## Purpose and scope

Complete the next bounded PR-F slice in `docs/mobile-release-task-list-2026-07-30.md` by extending the existing Mobile Page settings editor with:

- named style reference title and notes;
- read-only source-scene provenance;
- page purpose;
- continuity note.

This slice does not add or change Backend routes, request or response wire formats, database schema, migrations, repositories, workers, generation messages, credits, Web behavior, or the shared API contract. It consumes only the existing `PUT /api/pages/:id` contract and the already loaded Scene and Page records.

## Spec basis

- Unified Spec section 2: Page review includes editable visual and dialogue inputs.
- Unified Spec sections 3 and 5: Mobile is a client of existing authenticated, organization-scoped Page persistence; PostgreSQL remains the system of record.
- Unified Spec section 6: generation and regeneration use current saved inputs, so dirty Page settings must resolve before starting an existing generation transition.
- Unified Spec section 8: client inputs stay bounded and server structured output remains server-validated.
- Unified Spec section 10: Mobile checks plus the full repository verification gate are required before integration.

## Existing interface and data flow

The existing `PUT /api/pages/:id` accepts these fields without a contract change:

- `style_reference`: `{ title, notes } | null`, where title is 1–200 characters and notes is nullable up to 2,000 characters;
- `story_page_purpose`: nullable text up to 500 characters;
- `story_continuity_note`: nullable text up to 1,000 characters.

`story_source_scene_ids` is returned on `PageRecord` and displayed beside the already loaded episode Scenes. Mobile will not send or edit that array. The ordinary Page settings validator checks UUID shape and count but does not prove that each Scene belongs to the Page's episode; making it editable in this client could therefore persist invalid provenance. The current Web UI also treats source Scenes as display-only.

When style title or notes changes, Mobile sends only those two author-controlled values. The existing Page Service synchronously compiles and persists the canonical style brief and anchors. Mobile must never round-trip `layout_config`, `compiled_brief`, anchors, provider metadata, or compiler metadata. If both title and notes are cleared, Mobile sends `style_reference: null`; notes without a title are rejected locally to avoid silently discarding notes.

The strict existing Page response is checked by the API client. The component additionally verifies Page and episode IDs before updating the scoped React Query cache.

## Mobile design

- Extend the local `PageSettingsDraft`; do not change `PageRecord` or the shared schema.
- Normalize optional text with `trim()`, using `null` for an intentional clear.
- Build a changed-field-only payload. Unchanged style values do not invoke the style compiler.
- Validate all Backend length limits before any network request.
- Display every stored source Scene ID in saved order. Resolve known IDs to `Scene {order}: {location}` and retain unknown/deleted IDs as an explicit placeholder instead of dropping them.
- Include style title/notes, source Scene IDs, purpose, and continuity in the relevant remote-conflict fingerprint. This prevents an old semantic draft from being saved after Story AI or another client changes its context.
- Preserve the existing refresh-before-PUT, confirmed/generating and job-state blocking, single-flight, dirty save/discard/cancel, organization query, and session/workspace/episode/Page scope guards.

## Security and integrity controls

- No new authentication or authorization path; the existing protected Route and organization capability check remain authoritative.
- No client-controlled source Scene identifiers are persisted.
- No arbitrary layout object or server-generated style metadata is echoed back.
- Inputs are bounded locally and still validated by the existing strict Backend Zod schema.
- A remote relevant-field change, Page disappearance, episode mismatch, unsafe status, response ID mismatch, or scope switch fails closed while retaining the draft.
- No automatic retry of the PUT. A style compiler or network failure retains the draft for an explicit user retry.

## Expected impact

- Story consistency: purpose and continuity become explicit saved inputs for the next generation. Source provenance remains visible but cannot be corrupted by manual IDs. A concurrent provenance or semantic settings update forces review before saving.
- Save time: purpose/continuity-only saves add no provider work. A changed named style invokes the existing synchronous style compiler and can therefore take longer; unchanged style is omitted from the request.
- Data structure: unchanged. Only a Mobile-local draft and request interface are extended.

## Test-first plan

1. Domain tests: safe style extraction, normalization, per-field changed payloads, clear semantics, bounds, notes-without-title rejection, and relevant remote conflict detection.
2. API tests: exact organization-scoped request body and strict Page identity validation using the existing endpoint.
3. Component tests: source Scene and missing-source display, changed-only save, local validation without PUT, style compiler response cache adoption, remote change draft retention, read-only states, and existing scope/single-flight behavior.
4. PagesScreen test: the already loaded Scenes are passed to Page settings and dirty settings still resolve before Story autofill.
5. Run Mobile targeted/full checks, both OS exports, contract drift, Backend Vitest/Bun/build, fresh migrations and invariants, Web lint/build, and Playwright smoke before PR integration.

## Terra delegation

Terra owns a read-only contract and race audit. Sol owns the design, implementation, integration judgment, and final verification. Terra found no required Backend change and identified source Scene editing and incomplete remote-conflict comparison as P1 risks; this design incorporates both findings.
