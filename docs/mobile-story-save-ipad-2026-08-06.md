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
