# Mobile 1.0.7 store release design

Date: 2026-09-08
Branch: `codex/mobile-1-0-7-store-release`
Release branch base: `116710a`
Mobile runtime implementation: `aa6b7bd`
Final release metadata commit: `7188ebcf305fc3fd37aa724c570ee25e1211e855`

## Purpose and scope

Build Android App Bundle and iOS production artifacts from the same reviewed Mobile 1.0.7 source and runtime, upload the iOS artifact to App Store Connect, and submit it for review only when the live App Store Connect state permits an unambiguous 1.0.7 submission. The Android AAB is an output artifact for later Play Console handling; this task does not upload it to a Play track. Backend, AWS, database, authentication, authorization, credits, product identifiers, and store-account ownership are unchanged.

The protected primary checkout and its unrelated dirty files must remain untouched. All metadata edits, builds, evidence collection, and release commits belong to the isolated release worktree. This document records design only; release operations remain owned by the root integrator.

## Spec basis and affected layers

- Spec section 2: ship the corrected character save and reference-image workflow as one coherent Mobile release.
- Sections 4 and 5: retain the existing authenticated personal/organization scope and persisted-entity identity. Store work must not change API or tenancy behavior.
- Sections 6 and 8: retain generation, credit, upload MIME/size, and output-safety contracts. No retry or store step may create a generation job.
- Section 10: reuse the already-passing repository gates only when they apply to the exact release commit, then add binary/export and external-store evidence.

Affected layers are Mobile configuration/metadata and release Ops. Route, Service, Repository, Domain, Infrastructure, Worker, Web, database, and production AWS behavior are outside scope.

## Release identity

Before either production build, make the release source immutable and record its commit SHA. Both builds must resolve to that exact SHA and `expo.version = 1.0.7`; the `appVersion` runtime policy must therefore produce runtime `1.0.7` on both platforms. Do not publish an older-runtime OTA update during the release window.

EAS uses remote build-number management with `autoIncrement`. The completed APK is Mobile 1.0.7, Android version code 100. The AAB must receive a strictly greater Android version code. The iOS artifact must receive a new App Store Connect build number for bundle `jp.lyra.mobile`; its exact remote-assigned value is evidence, not a value to predict in advance.

Update `store.config.json` from Apple version `1.0.4` to `1.0.7` before the iOS submission. Provide matching Japanese and English release notes that describe the user-visible iOS release, including:

- character details are saved before the photo library opens;
- character saving is more reliable;
- preview generation and confirmation after image import were improved.

Android permission compatibility is omitted because it is not relevant to iOS users. The notes must not claim that an Android release was published or that untested physical-device behavior was verified. Existing title, description, URLs, age rating, privacy declarations, copyright, manual release, and phased-release settings remain unchanged unless current App Store Connect validation explicitly requires a separate reviewed correction.

## Build and artifact sequence

1. Verify the isolated worktree starts from remote source `116710a`, contains reviewed Mobile runtime implementation `aa6b7bd`, and is clean at the final release metadata commit. Confirm its remote branch/PR state is reviewable, package lock is unchanged from reviewed 1.0.7, and the primary checkout remains untouched.
2. Verify the existing EAS project owner/project ID, Apple bundle ID, Android package, submit profile, and credential-owner identity through non-secret CLI/account output. Record account names and credential identifiers or fingerprints only; never archive sessions, tokens, private keys, provisioning contents, or service-account JSON.
3. Update and test only the reviewed Apple metadata/version and release notes, then commit it so both platform builds refer to one final source commit. If this changes the commit after prior CI, rerun metadata-focused checks and confirm the application source diff is otherwise unchanged.
4. Start a `production` Android AAB build and a `production` iOS device/store build from the same final commit. Record each EAS build ID, platform, status, app version, native build number/version code, commit SHA, profile, channel, runtime, artifact URL reference, and creation/completion time.
5. Download artifacts to the non-secret evidence directory and retain hashes. Do not commit binaries.
6. For the AAB, inspect the final merged manifest and bundle metadata: package `com.lyra.mobile`, version 1.0.7, version code greater than 100, production update channel/runtime, release signing certificate continuity, non-debuggable state, 16 KB native-library alignment, and absence of the six blocked read/location permissions. `WRITE_EXTERNAL_STORAGE` may remain only with its reviewed legacy maximum SDK.
7. For iOS, verify a valid archive/export and inspect the exported IPA metadata: bundle `jp.lyra.mobile`, short version 1.0.7, new build number, expected supported locales, production/runtime configuration, non-simulator architecture, distribution signing/team consistency, embedded provisioning validity, entitlements/associated domains, privacy manifest, and absence of development-only endpoints. Verify artifact integrity before upload.
8. Upload the exact verified iOS build ID/artifact with the production submit profile. Do not use an ambiguous “latest” build selector when more than one candidate exists. Wait for App Store Connect processing and verify the processed build reports version 1.0.7 and the recorded build number.

## App Store Connect state boundary

Uploading a binary, attaching a processed build to an App Store version, submitting that version for App Review, and releasing an approved version are separate external states and must be reported separately.

Read the live App Store Connect state before mutation:

The pre-release read on 2026-09-08 found 1.0.2/build 34 `READY_FOR_DISTRIBUTION` and 1.0.4/build 36 `IN_REVIEW` (sanitized evidence: `asc-status-before.json`). The active 1.0.4 review must not be cancelled or replaced. Under this observed state, the authorized 1.0.7 path is to build, upload, wait for processing/validation, and preserve the valid build for the next editable version. Review submission of 1.0.7 is currently blocked until App Store Connect permits a later version; the final report must identify the remaining follow-up rather than claim that 1.0.7 entered review.

- If no editable 1.0.7 version exists and the current app state permits creation, create/select 1.0.7, apply the reviewed JA/en-US metadata, attach the exact processed build, satisfy export-compliance and required-version fields from the existing truthful configuration, and submit for review.
- If an editable 1.0.7 version already exists, reconcile its build and localized metadata with this design before submission; never create a duplicate version.
- If another version is `PREPARE_FOR_SUBMISSION`, `WAITING_FOR_REVIEW`, `IN_REVIEW`, pending developer release, or otherwise blocks a new version, do not cancel, reject, replace, or release it automatically. Preserve the uploaded 1.0.7 build and report the exact blocking state and the remaining App Store Connect action.
- If agreements, tax/banking, role permissions, compliance questions, screenshots, privacy answers, or reviewer information require a new factual decision, stop at the furthest reversible completed state. Do not invent answers.
- `automaticRelease: false` means review submission does not authorize public release. Approval remains held for manual release unless the user separately authorizes release.

Successful upload may therefore be complete while review submission remains blocked. Report the build upload as successful and the review state as pending/blocked rather than conflating the two.

## Verification gates and evidence

The exact 1.0.7 application commit already has 710 tests passing and both repository CI checks passing. Reuse that evidence after confirming commit ancestry and that the release-only metadata change cannot alter application behavior. Run the focused app-metadata tests and diff check against the final metadata commit. If application source, dependencies, native plugins, EAS profile, runtime configuration, permissions, entitlements, or lockfile change, the prior gate reuse is invalid and the affected Mobile/full gates must run again.

Required additional evidence:

- final clean status and exact commit for both builds;
- EAS Android/iOS finished states and native version identifiers;
- SHA-256 hashes for AAB and IPA;
- AAB manifest, signing, runtime/channel, alignment, and permission inspection;
- iOS archive/export, Info.plist, runtime, architecture, signing/team, provisioning expiration, entitlement, privacy-manifest, and production-endpoint inspection;
- App Store Connect upload/processing result and the precise version/build association;
- live App Store version state before and after any review submission;
- confirmation that no Play Console upload, backend/AWS mutation, credential rotation, automatic App Store release, or primary-checkout modification occurred.

Archive sanitized command output and structured status JSON. Redact artifact download URLs when they contain temporary credentials, and never print or preserve authentication tokens, signing private material, session cookies, or private API responses.

## Failure and rollback rules

- A failed build creates no store mutation; fix only after classifying whether the cause is source, metadata, credentials, or EAS infrastructure.
- A failed upload leaves the verified artifact/build record intact. Retry the exact build only for a retryable transport/processing failure; do not silently build different source.
- If App Store processing reports invalid metadata, signing, entitlement, privacy, encryption, or version/build identity, treat it as a release blocker and do not submit another artifact until the discrepancy is reviewed.
- Before review submission, metadata/build attachment is reversible. After submission, do not withdraw or replace the version without explicit user direction.
- Android AAB remains local/EAS-only in this task. No Play track rollback is needed because no Play submission is authorized.

## Release risks and decisions

1. **Live App Store state is unknown until queried.** This can block review submission even when build and upload succeed. The design requires reporting the exact state rather than changing an existing submission.
2. **Apple metadata is currently 1.0.4.** Submitting without updating it risks attaching 1.0.7 to stale release notes/version metadata. This is a required pre-submit change.
3. **Remote auto-increment is stateful.** The next Android/iOS native build numbers must be verified from completed build records; they must not be assumed from APK code 100.
4. **Physical-device acceptance is not newly proven by CI or binary inspection.** Archive/export and static artifact checks support submission, but they do not prove photo-library, sign-in, purchase, or deep-link behavior on a real iPhone.
5. **Store upload and public release differ.** Review submission is permitted only under the state rules above; automatic public release remains disabled.

## Terra delegation packet

Terra may perform one bounded read-only validation after root produces artifacts and sanitized status evidence. Purpose: independently confirm that both artifacts came from the same final commit/runtime, inspect Android/iOS binary identity and safety properties, and compare the reported App Store Connect state with the boundary above. Ownership: no source files. Forbidden: metadata edits, EAS builds/submissions, App Store actions, Play Console actions, AWS/backend calls, credential changes, commits, or exposure of secrets/download URLs. Expected output: a concise evidence table, discrepancies, and blocker/non-blocker judgment for Sol review.
