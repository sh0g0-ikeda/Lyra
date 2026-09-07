# Android photo permissions rejection remediation design

Date: 2026-09-07

Branch: `codex/mobile-photo-permissions`

Base: `00dbabf`

## Purpose and scope

Google Play rejected Android version codes 92 and 95 because their manifests request `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO`. The replacement release must import a single user-selected character image through the Android system picker and save a generated page only after an explicit user action, without broad photo or video read access.

This change is limited to the mobile app's native permission configuration, image-save adapter, contract tests, and release evidence. It does not change backend APIs, authentication, authorization, billing, database state, image-download validation, or Play Console tracks. This task produces AAB and APK artifacts but does not submit them.

The closest current contract is `docs/Lyra_Unified_Spec_v4.md` section 8 (safe image input/output) and section 10 (release verification). The affected layers are Mobile and Ops only.

## Intended behavior

- Character import continues to call `expo-image-picker`'s `launchImageLibraryAsync` without a media-library permission pre-prompt. On supported Android versions this delegates selection to the system picker and grants access only to the selected item.
- The Android release manifest must not contain `READ_MEDIA_IMAGES` or `READ_MEDIA_VIDEO`. Configuration also blocks `READ_MEDIA_AUDIO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE`, and `ACCESS_MEDIA_LOCATION` against transitive reintroduction.
- Saving a generated image remains an explicit action. Android API 24–29 requests write-only access before using `MediaLibrary.Asset.create`; API 30–36 calls `Asset.create` directly through scoped `MediaStore`. iOS keeps its add-only permission request (`writeOnly: true`).
- Downloaded bytes continue to be signature-checked before registration, HTTPS/authentication fallback behavior remains unchanged, and stable error codes continue to drive both Japanese and English messages.
- Android API 24–28, API 29, API 30–32, and API 33–36 behavior must be supported or given an explicit user-controlled fallback based on the installed Expo 57 native implementation. The implementation choice is accepted only after source and built-manifest verification.

## Interfaces and security

Inputs and outputs remain the current `saveImageToPhotoLibrary` contract: HTTPS sources, a bounded normalized filename, expected MIME type, and a local URI result or stable `MobileFileTransferError`. No new persistence or external API is introduced.

The security boundary is least-privilege device access. The app may read only the item selected by the system picker and may write a downloaded, signature-validated image after the user taps save. It must not request general photo/video library read access. Existing bearer-token refresh and signed-URL fallback remain inside the download adapter; no token or provider error may enter logs, UI copy, tests, artifacts, or PR text.

## Tests-first plan

Before implementation, update tests and observe the expected failures:

1. `tests/appMetadata.test.ts` asserts the media-library plugin uses an empty `granularPermissions` list and that Android blocks `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE`, and `ACCESS_MEDIA_LOCATION`.
2. `tests/download.test.ts` asserts Android API 24–29 requests write-only access, Android API 30–36 does not request media-library access, and iOS requests add-only access. Permission grant and denial paths remain covered. Every successful path passes the verified local URI to `MediaLibrary.Asset.create`.
3. Existing MIME-signature, authentication-refresh, fallback-source, storage, cancellation, and localized error tests remain green.

Test names remain in Japanese. The expected red phase must fail because current configuration requests granular photo access and current saving unconditionally requests media-library permission.

## Native evidence and API-level decision gate

The locked Expo 57 sources for `expo-media-library` and `expo-image-picker` must be inspected after dependency installation. The review records exact source paths for:

- config-plugin permission injection and any `maxSdkVersion` qualifiers;
- Android implementation of `requestPermissionsAsync(true)`;
- Android implementation and permission checks for `Asset.create` and `saveToLibraryAsync`;
- image-picker use of the platform picker and any legacy fallback.

The installed Expo 57 sources establish the implementation matrix. `MediaLibrary.Asset.create` uses the legacy factory below Android R and requires only `WRITE_EXTERNAL_STORAGE`; from Android R it uses the modern `MediaStore` insert/copy/publish path without a broad runtime permission. `requestPermissionsAsync(true)` suppresses read permissions, but it is needed only on Android API 24–29. iOS continues to request add-only access before saving. Expo 57's root `saveToLibraryAsync` export deliberately throws as deprecated, while the `/legacy` implementation still requires system permissions, so neither is used.

The media-library config plugin adds legacy read/write declarations and `READ_MEDIA_VISUAL_USER_SELECTED` unconditionally, and maps non-empty granular selections to `READ_MEDIA_*`. The image-picker dependency also carries legacy read/write declarations. Therefore the plugin uses `granularPermissions: []`, all unused read/location permissions listed above are blocked, and `WRITE_EXTERNAL_STORAGE` remains only for API 24–29 compatibility. The generated release manifest and artifacts remain the authority over source-level expectations.

## Verification and release evidence

Run the narrow checks first, then release checks:

- `npm test -- --run tests/appMetadata.test.ts tests/download.test.ts` from `apps/mobile` (or the equivalent Vitest invocation accepted by this package)
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run contracts:check`, and `npm run check:mojibake` from `apps/mobile`
- Android export/build checks required by the build profile
- the applicable repository release gates from Spec section 10; any environment-dependent skips are reported explicitly

Permission proof is a release condition, independent of JSON tests. Inspect the generated merged release manifest and both built artifacts. Report every declared Android permission and fail the release if the AAB or APK contains `READ_MEDIA_IMAGES` or `READ_MEDIA_VIDEO`. Also check `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE`, and `WRITE_EXTERNAL_STORAGE`; any retained legacy declaration must have a documented API bound and native-source reason.

Record artifact paths, version codes, SHA-256 checksums, build profile, and manifest inspection output. The Play Console submission and removal/replacement of rejected artifacts on every track are separate operator steps outside this task.

## Terra delegation and integration

Terra receives a read-only native-source audit covering Expo 57 permission injection, runtime behavior, the API 24–36 save matrix, and executable manifest inspection commands. Terra owns no files. Sol owns this design and final review; the root integrator owns test/implementation files, build operations, commits, push, and PR. Sol will reject changes outside the intended paths, broad permission requests, an Android permission pre-prompt, missing red-phase evidence, or artifacts without manifest proof.

The primary checkout had pre-existing deletions, modified documentation/scripts, and untracked audit/store assets. Work therefore proceeds in this isolated worktree from `00dbabf`; none of those primary-checkout paths may be included or reverted.
