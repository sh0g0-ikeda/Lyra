# Mobile: story save confirmation and iPhone-only submission

Date: 2026-08-06
Branch: `fix/mobile-export-reliability` (continued because the worktree already has unrelated user changes; do not switch, pull, reset, or stage those paths.)

## Purpose and scope

Make the Mobile unsaved-changes confirmation wait for the actual story-save result, so navigation continues only after a successful save and a failed save leaves the dialog and drafts available for retry. Set the iOS Expo metadata to iPhone-only.

This change is limited to Mobile dirty-state UI, its StoryScreen save wiring, the iOS metadata, and their tests. It does not change API contracts, persistence, generation jobs, credits, authorization, Web UI, or exported-image behavior.

## Spec basis and affected layers

- `docs/Lyra_Unified_Spec_v4.md` section 3: Mobile remains a consumer of existing API contracts; no route, service, repository, or domain persistence responsibility moves into UI.
- Section 8: provider/API failures remain handled as stable user-facing errors; no raw error or credential is displayed.
- Section 10: targeted Mobile tests, typecheck, lint, contract check, mojibake check, and iOS export are required before a release build.

Affected layer: `apps/mobile` only. The dialog receives a selection while a pending navigation owns the resolution Promise. A Save selection transitions `open -> saving -> success -> close and resolve(true)` or `open -> saving -> failure -> open/retryable`; Discard resolves `true`, and Cancel resolves `false`.

## Interface and safety

- `DirtyStateProvider` owns the pending-navigation lifecycle and rejects duplicate Save selections while a save is in flight.
- Registered editors keep their existing `save(): Promise<void>` interface. `StoryScreen` registers the same `saveStoryDrafts` function that the normal Save action uses.
- Only a successful save clears resolved dirty registrations. A failed save preserves draft and clean-baseline state.
- No new external API, request payload, SQL, secret, authentication, authorization, or credit flow is introduced.

## Test and delegation plan

TDD first: add provider tests showing that the dialog stays open while Save is pending, remains open after a rejected save, and resolves navigation only after a retry succeeds. Run the targeted tests to observe the old lifecycle failure before the implementation change, then cover the existing Save/Discard/Cancel behavior.

Sol retains architecture, integration, and release decisions. Terra is delegated only a read-only inspection of the current lifecycle and StoryScreen wiring; it owns no files and cannot make changes.

## Follow-up: production validation error investigation

After the initial implementation, a device reported the same `VALIDATION_ERROR` for both the confirmation Save action and the normal Story Save action. The prior tests covered dialog lifecycle and source wiring, but did not prove that the registered save path sends a payload accepted by the existing episode API contract.

This follow-up remains limited to the Mobile Story save path, its payload compatibility helpers, and tests. It will trace the stable user-visible validation error to the outbound request and current bounded server schema before changing behavior. The fix must retain `expected_updated_at`, preserve drafts on failure, avoid exposing raw API details, and add a failing regression test using the affected payload shape. No API route, database, authorization, credit, or generated-output contract will be changed unless a verified server/mobile contract mismatch requires it.

The trace found two Mobile-only conditions. First, the production API can reject `expected_updated_at` as an unknown key even though the current repository schema requires it. The client will retry only that explicit legacy-contract 422 once without the revision field; current APIs continue to receive the field, and all other validation errors remain failures. Second, the Episode section's normal Save control must only save the episode. Navigation resolution remains the only path that saves every registered dirty editor, including a Scene draft, so an unrelated Scene validation failure cannot be reported as an Episode Save failure.

## Follow-up: local character image import recovery

**Scope:** Mobile photo-library image import for character creation on both iOS and Android: compatible asset selection, direct-upload recovery, and tests. It excludes entity persistence, S3 keys, backend image validation, credits, and authorization.

**Spec basis:** `docs/Lyra_Unified_Spec_v4.md` sections 3, 4, and 8. The existing `docs/entity-reference-upload-design.md` retains the bounded `image_base64` import contract while direct upload remains the preferred path.

**Interface and safety:** Select one image without EXIF, request iOS's compatible representation so HEIC is converted to a supported JPEG, and request the same bounded Base64 representation on Android for a narrowly guarded fallback. Validate JPEG/PNG/WebP magic bytes and a decoded size of at most 5 MiB before retaining that data. Direct presign -> PUT -> opaque-token finalize remains first choice on both platforms. Use the legacy body only if the presign endpoint is unavailable (404/405) or the signed PUT returns a non-retryable 4xx; do not fall back after a successful PUT/finalize, do not retry analysis, and retain all server-side MIME, size, ownership, and token checks.

**Test plan:** First add regression tests for picker-compatible image decoding and fallback only on unavailable presign/non-retryable PUT; prove that transport/5xx failures remain retryable direct-upload errors. Then run focused Mobile tests, the full Mobile suite, typecheck, lint, contracts/mojibake checks, iOS export, and Android export.

## Follow-up: initial editor hydration must not prompt for a save

**Purpose and scope:** On a newly installed app, opening an editor for the first time can briefly compare empty local fields with a selected resource before its query has hydrated. If that transient comparison is registered as dirty, the next navigation incorrectly shows Save / Discard / Cancel once for each editor. This change makes that first hydration clean for Story and Characters, matching the existing Pages behavior. It retains the explicit Save controls and retains the navigation confirmation for edits the user has actually made.

**Spec basis and affected layers:** This is an `apps/mobile` state/UI change under Unified Spec sections 3 (Mobile remains an API consumer), 8 (no raw errors or new inputs), 9 (avoid a user-blocking false interaction), and 10 (targeted regression tests plus Mobile checks). It changes no route, service, repository, persistence, authorization, credits, job, or Web behavior.

**Interface and safety:** Reuse `editorDraftHasUnsavedChanges` and `shouldHydrateEditorDraft`. A draft is dirty only after its selected server resource has been loaded and synchronized once; an empty new-resource editor remains dirty after the user enters a value. Do not auto-save or discard data. The global dialog remains available only for actual unsaved edits, and each editor retains its normal explicit Save action.

**Test and delegation plan:** First add a source-level regression test requiring Story and Characters to use the shared hydration policy; it must fail against the current files. The existing pure policy tests cover the initial-load, resource-switch, and real-edit truth table. Then apply the smallest imports, dirty predicates, and hydration guards. Sol retains the cross-editor integration because the same global dirty registry owns the immediate decision; no Terra delegation is used for this small, coupled Mobile-only fix.
