# Mobile character save synchronization design

Date: 2026-09-07
Branch: `codex/mobile-character-save-sync`
Base: `f835841`

## Purpose and scope

Fix the mobile character editor so every successful create or update immediately adopts the returned server entity and its new `updated_at`, even when the next reference-generation request fails. This prevents a successful pre-generation save from leaving the editor on an obsolete revision and causing the next Save to fail with `409 RESOURCE_STALE`.

The same synchronization covers a persisted selected entity that is outside the currently loaded pages of the infinite entity list. The change includes mobile entity cache synchronization, character-editor mutation and immutable import-candidate wiring, focused tests, release version `1.0.6`, and an Android `production-apk` build. It also includes the smallest backend query-validation correction needed for organization-scoped candidate preview. It does not change persistence, authentication, authorization rules, organization membership, credits, token cryptography, generation semantics, or Google Play state.

The closest contract basis is `docs/Lyra_Unified_Spec_v4.md` sections 2 (entity workflow), 4 (authorization), 5 (persistence), 8 (image safety), and 10 (verification). The affected layers are Mobile, Route, and Ops. The backend patch must be based independently on the deployed `dda4fda` line so the mobile branch's unrelated backend differences cannot enter production.

## Confirmed failure

The reference-generation mutation currently performs a character PUT, discards the returned entity, and then starts generation. Its list invalidation runs only when generation also succeeds. If generation returns `422`, the save has already advanced the server revision while both the list/detail cache and editor retain the old `updated_at`. A later Save sends that obsolete revision and receives `409`.

A second reachable case occurs after restoring a persisted selection for an older entity that is absent from the first `created_at DESC` list page. The screen loads it through the separate `entity-detail` query, but a normal update invalidates only the `entities` prefix. TanStack Query does not put mutation responses into either cache automatically.

## Design

Add one small, typed entity-cache synchronization helper. Given `QueryClient`, the exact session key, work ID, organization ID, and returned `EntityRecord`, it must:

1. cancel in-flight reads for the exact entity-detail key and exact entity-list prefix before writing, so a request started before the mutation cannot overwrite the successful response;
2. set the exact `entityDetailQueryKey` for the returned entity;
3. update that entity in every currently loaded page of the exact `entitiesInfiniteQueryKey`, preserving page order, cursors, unrelated records, and pages; if the entity is not loaded, do not insert it into an arbitrary page;
4. accept a returned record only when its revision is not older than the cached record, so overlapping successful mutations cannot move either cache backward;
5. keep normal list invalidation as eventual server reconciliation after the authoritative response is installed.

Revision comparison uses parsed `updated_at` timestamps with a deterministic equality/fallback rule. An invalid timestamp must not silently replace a cache entry with a known newer valid timestamp. No broad `['entities']`, cross-session, or cross-organization write is allowed.

Create and update mutations use the same synchronization path. Extract the existing-update operation so the Save button and the save-before-generation path cannot drift into duplicate implementations: build the minimal payload once, call `api.updateEntity` once, synchronize its returned entity immediately, clear stale state, then return it. The generation request runs only after that sequence. A generation failure must not undo the saved entity or its cache state. `409` remains a real concurrency error; do not retry without a current revision and do not remove `expected_updated_at` from the current API path.

## Draft and candidate preservation

Cache replacement can trigger the editor hydration effect, so synchronization must not erase work created after the submitted snapshot.

- If the user types again while a PUT is in flight, the returned entity becomes the new server baseline while the newer local text remains dirty and visible.
- Server normalization of submitted values may hydrate the normalized result only when there is no newer local edit.
- A same-entity cache refresh must preserve `candidateToken`, `lastImportedCandidateToken`, `lastImportedCandidateEntityId`, pending import result, and local reference-job state. These transient values are cleared only when the selected entity identity or workspace scope changes, or by their explicit confirm/discard flows.
- Suggested structured fields already applied by image import remain visible after the automatic pre-generation save, including when generation returns `422`.

This requires separating “hydrate saved fields from a newer same-entity snapshot” from “reset entity-scoped transient state on identity change”; cache synchronization must not work around the issue by withholding the returned revision.

## Preview candidate contract correction

Two preview failures are distinct and remain separately testable.

The organization-scoped candidate image GET is rejected because the route reads `organization_id` for authorization and then validates the complete query with a strict candidate-only schema. Fix route validation to accept the already parsed optional organization query, or validate only the candidate fields. Keep `parseOptionalOrganizationId`, `requireOrganizationCapability(..., 'view_work')`, entity ownership/membership scoping, signed candidate-token verification, and `private, no-store` output unchanged. The mobile client continues sending `organization_id`; removing it would break tenant scope.

The generation request's `Invalid reference candidate token` must not be bypassed by silently omitting the imported candidate. The mobile import operation captures an immutable entity/workspace scope when selection begins. Its completion may publish the candidate only if the active editor still has that exact scope, and `lastImportedCandidateEntityId` comes from the immutable completed upload binding rather than a later render's selected entity. A finalize response arriving after an entity/workspace transition is discarded from the active editor. This preserves token-to-user/entity binding without changing token format or weakening validation.

Image import requires a persisted, currently resolved entity. Disable it while character creation is pending, while the editor is in create mode, or while `selectedEntity` is null, with the existing bilingual select/save-first explanation. Re-check the immutable identity after the native picker returns and before presign. Presign and finalize always carry that non-null entity ID. Do not auto-create from inside a cancellable picker flow, relabel an unbound token, or silently generate without the imported image.

The production binding failure was confirmed by a read-only transaction against the consumed upload row: the upload had no entity ID even though generation subsequently targeted a saved entity. Only binding and timestamp metadata were returned; tokens, signatures, image keys, secrets, and private character content were not exposed. This is consistent with the picker/selection race above. An already issued unbound token cannot be repaired by changing its client-side label: after installing the fixed APK, select the saved character and import the original image again to obtain a correctly bound candidate.

## Tests-first matrix

Observe expected failures before implementation, then cover:

1. pre-generation update succeeds, returned `updated_at` advances, generation returns `422`, and the exact detail/list cache retains the returned entity;
2. the next manual Save uses the returned `updated_at` rather than the old revision;
3. an entity absent from loaded infinite-list pages still updates its exact detail cache, with list pages unchanged;
4. an entity present on any loaded page is replaced in place without changing order, cursors, other pages, session, work, or organization caches;
5. an older overlapping response cannot overwrite a newer cached revision, while an equal/newer response is accepted;
6. an in-flight entity read is cancelled before the mutation response is installed;
7. text entered after mutation submission remains visible and dirty after the response; submitted text without later edits may adopt server normalization;
8. imported candidate token, candidate/entity binding, suggested structured fields, and import result survive the same-entity automatic save and a subsequent generation failure;
9. switching entity or workspace still clears entity-scoped transient candidate/import state;
10. normal manual update and create use the shared cache synchronization once and retain existing stale-error behavior;
11. personal and organization query keys remain isolated;
12. existing entity payload, API compatibility, dirty-editor, character UI, import, and reference-generation blocker tests remain green.
13. organization-scoped candidate GET accepts `organization_id`, still requires `view_work`, passes organization scope to image export, and rejects unrelated query fields;
14. personal candidate GET behavior and user/entity-bound signed-token validation remain unchanged;
15. import completion after an entity or organization transition cannot publish its token into the new editor, while unchanged scope records the immutable upload entity ID;
16. generation never falls back from an invalid imported token to an unreferenced generation request.
17. Import remains disabled between character POST success and selection/detail resolution, then becomes enabled for the resolved saved entity;
18. presign and finalize receive the same non-null immutable entity ID, including across asynchronous picker/upload boundaries.

Prefer a focused cache-helper unit test plus a small mutation/state harness that executes the actual save-before-generation sequence. Static source-string assertions alone are insufficient for the failure. Test names follow the repository's Japanese convention.

## Verification and release

Run targeted red/green tests first, then mobile typecheck, lint, complete Vitest, contract/inventory/parity checks, mojibake check, Expo dependency/doctor checks, and the applicable repository release gates from Spec section 10. Review the final diff for only the design, cache helper, character mutation/hydration wiring, tests, and version metadata.

Build Android `production-apk` as version `1.0.6` from the reviewed mobile commit. Record EAS status, build number, commit SHA, artifact SHA-256, package/version/runtime, signing-certificate continuity, zip alignment, 16 KB native-library alignment, and the existing forbidden-permission checks. Do not submit to Play Console.

Prepare the backend route fix in a separate worktree from deployed commit `dda4fda`, run targeted route/security tests followed by backend tests/build and applicable release gates, and review the exact production diff before rollout. Deploy API only after the reviewed commit and image are correlated. Verify readiness, both service tasks on the new task definition, organization and personal candidate-image behavior, error and 5xx signals, queue health, and post-deploy logs. Keep task definition 129 and its image reference as the rollback target; roll back if readiness, authorization scope, or candidate delivery regresses. No database migration is expected.

## Delegation and ownership

Sol owns this design and final review. Root owns tests, implementation, integration, verification, commits, pushes, PRs, APK build, and the authorized API-only rollout. Terra may independently audit cache keys, revision monotonicity, hydration races, tenant-safe query validation, deployment gates, and test coverage without editing outside an explicitly assigned scope. The primary checkout's existing dirty paths remain protected; mobile and backend work remain in separate isolated worktrees.
