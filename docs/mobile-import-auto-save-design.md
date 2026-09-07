# Mobile image import auto-save design

Date: 2026-09-07
Branch: `codex/mobile-import-auto-save`
Base: `0799f47`

## Purpose and scope

When the user taps **画像取り込み / Import image**, save the current character first when needed and open the system photo album only after that save succeeds. A new character is created from the current draft; an existing dirty character is updated; an existing clean character opens the picker without an unnecessary request.

This replaces the temporary “save first” gate added in 1.0.6 while preserving its security result: presign, finalize, preview, and generation always use a real immutable entity ID. The change is Mobile only and targets Android APK version `1.0.7`. It does not change API 130, AWS, database contracts, authentication, authorization, credit behavior, token format, or Play Console state.

The closest contract basis is `docs/Lyra_Unified_Spec_v4.md` sections 2 (entity and reference workflow), 4 (authorization), 5 (persistence), 6 (generation jobs), 8 (image safety), and 10 (verification).

## User-visible sequence

For a new draft:

1. Require edit/generate capability, an active work, and a non-empty character name. If the name is empty, show a clear Japanese or English name-required message and make no API, picker, upload, or credit-consuming call.
2. POST the character exactly once through the shared create operation.
3. Adopt the returned entity in the exact detail/list cache and update the persisted selection.
4. Open the system picker using the returned entity itself as the immutable import binding; do not wait for React to re-render `selectedEntity` before deciding the ID.

For an existing draft, PUT once if it is dirty, adopt the returned entity, then open the picker with that returned entity. If it is clean, bind the picker to the current selected entity without PUT.

Cancelling the picker does not undo a successful POST/PUT. A created character stays selected and the next import attempt reuses it, so cancellation cannot create duplicates.

## Operation coordinator

Extract shared typed operations instead of calling one React mutation from another:

- `createAndAdoptEntity(draftSnapshot, operationScope): Promise<EntityRecord>` is used by the normal Create action and import preparation.
- `updateAndAdoptEntity(payload, draftSnapshot, operationScope): Promise<EntityRecord>` is used by normal Save, save-before-generation, and import preparation.
- `prepareEntityForImageImport(operation): Promise<EntityRecord>` selects create, update, or clean reuse and returns the entity that owns the candidate.

The helpers call the API once, synchronize the returned entity through the existing monotonic cache helper, preserve later user typing, and return the server record. UI mutations own loading/error presentation but do not duplicate persistence logic.

Use a synchronous operation ref/token as a mutex across Create, Save, save-before-generation, and import preparation. React `isPending` alone is not sufficient because two taps may occur before a pending-state render. A second conflicting operation exits without another POST/PUT/picker/upload/generation call. Buttons reflect the shared busy state for feedback.

Capture an immutable operation scope containing session key, organization ID, work ID, starting editor identity, entity type, draft signature, and operation token. After every await—POST/PUT, selection persistence, picker, presign/upload, and finalize—verify that the session/organization/work scope and operation token are still current. For an existing entity, also require the same selected ID. For a newly created entity, allow the transition from the starting null selection to the returned ID, but no other selection.

If scope or selection changes while saving, keep the successful server save and cache update in its original exact scope, but do not open the picker or publish a late import result. If scope changes while the picker is open or upload/finalize is pending, discard the result from the active editor. Never move a candidate between entities or organizations.

## React state and draft safety

The returned `EntityRecord` is the authority for entity ID and revision. `updateSelection` persists navigation state, but the import sequence does not depend on a React render, query refetch, or closure gaining the new entity.

Keep a narrowly scoped `createdEntityHandoff` containing the operation token, session/organization/work scope, starting editor epoch and draft signature, and returned entity. Install it after POST/cache synchronization and before `updateSelection`. It is valid only while the selection is still null or has changed to that exact returned ID. Picker cancellation may retain it until selection commit so a second Import tap reuses the entity instead of issuing another POST; clear it as soon as the matching selected entity resolves or any scope, epoch, or different selection appears.

Represent the expected null-to-created-ID change as a one-use planned transition. Hydration consumes only that exact transition, updates edit mode and `lastSyncedEntityId`, and skips transient candidate reset. It hydrates returned fields only when the submitted draft signature still matches. Do not treat other selection changes as planned.

Use an editor epoch independent of `selection.entityId`. Increment it for user-initiated New draft/reset, another entity selection, and workspace scope changes. This detects a second New draft even when both states have a null entity ID and invalidates pending save/import results.

The draft signature captured at submission determines hydration:

- if no newer edit exists, show server-normalized fields;
- if the user types while save is pending, update the cache baseline and keep the newer local draft visible and dirty;
- do not clear an existing same-entity imported candidate during cache synchronization;
- for a newly created entity, transition editor identity deliberately without treating the expected null-to-returned-ID change as a foreign scope change;
- clear candidate/import state only for an actual entity/workspace change or explicit discard/confirmation.

Picker cancellation after create must leave the editor in edit mode with the returned revision. Save failure leaves the draft intact, reports the existing actionable error, releases the operation lock, and never opens the picker. Picker failure/cancellation occurs after persistence and must not report the save as failed.

## Security and billing

Every import presign and finalize payload includes the same non-null entity ID returned or selected by preparation. Organization ID remains on every organization-scoped request. Existing ownership/membership checks, MIME/size/signature checks, upload-token consumption, candidate-token binding, and generation credit checks remain unchanged.

No image read/upload, analysis, generation, or credit-consuming request occurs before a required save succeeds. Do not recover from an invalid candidate token by generating without the imported image. Do not retry POST or PUT automatically after an uncertain network result; duplicate creation and revision conflicts require a fresh server-confirmed state.

## Tests-first matrix

Add real screen/mutation tests and observe the expected failures before implementation:

1. new draft with a name: one POST succeeds, exact returned entity is cached/selected, then picker opens, and presign/finalize carry the returned non-null ID;
2. new draft without a name: localized name-required feedback; zero POST, picker, upload, analysis, generation, and credit-related calls;
3. new POST failure: draft preserved, picker never opens, operation unlocks for retry;
4. picker cancellation after POST: created entity/revision remains selected; a second tap does not create a second entity;
5. existing dirty entity: one PUT with current revision completes before picker; returned revision and ID bind import;
6. existing clean entity: picker opens with zero POST/PUT;
7. save-before-import failure or `409`: picker/upload do not start and stale handling remains intact;
8. rapid double tap and simultaneous Create/Save/Generate/Import attempts cause at most one persistence operation and one picker;
9. scope/entity change during POST/PUT prevents picker opening but retains the completed save only in its original scoped cache;
10. scope/entity change while picker/upload/finalize is pending prevents presign when possible and prevents late token/suggested fields from entering the new editor;
11. a new entity uses the returned record without waiting for selection rerender; delayed `updateSelection` cannot cause `entity_id:null`;
12. typing during save is not overwritten; no-later-edit path adopts server normalization;
13. immutable entity ID is identical across presign, finalize, candidate preview, confirmation, and generation;
14. Japanese and English labels explain missing name, save failure, and changed selection without exposing provider details;
15. existing character save/cache, import upload, candidate binding, generation, dirty-state, permission, and API-contract suites remain green.

Static source checks are insufficient. Use a controlled real `CharactersScreen` harness with deferred POST/PUT, selection update, picker, upload/finalize, and scope changes, plus focused pure-operation tests if coordination logic is extracted.

## Verification and release

Run targeted red/green tests, full mobile Vitest, typecheck, lint, mojibake, API contract/inventory/parity checks, Expo dependency check/doctor, Android export, and applicable repository release gates. Review the final diff for Mobile-only scope and verify API/backend files are unchanged from `0799f47`.

Build `production-apk` version `1.0.7` from the reviewed commit. Record EAS status/build number/commit, SHA-256, package/version/runtime, upload certificate continuity, zip alignment, 16 KB native-library alignment, and forbidden-permission absence. Do not deploy API/AWS changes or submit to Play Console in this task.

## Terra validation packet

Objective: independently validate the implemented import auto-save sequence using the real screen harness.

Read-only scope: `apps/mobile/src/screens/CharactersScreen.tsx`, any extracted Mobile coordinator/cache helper, i18n keys, `apps/mobile/tests/CharactersScreenSave.test.tsx`, new focused tests, and mobile API payload types. Base `0799f47`; primary checkout dirty paths are out of scope.

Validate the 15 cases above, prioritizing new POST then picker without React rerender, cancellation without duplicate creation, failed save preventing picker/upload, double-tap mutual exclusion, scope change at each await boundary, late typing preservation, and exact non-null immutable entity ID through presign/finalize/generation. Do not edit, build, access networks/secrets, or run production operations. Return findings by severity, exact missing assertions, commands/results, and residual device-level risks.

Sol owns design and final review. Root owns tests, implementation, integration, verification, commit, push, PR, and APK build. The primary checkout and API 130 remain untouched.
