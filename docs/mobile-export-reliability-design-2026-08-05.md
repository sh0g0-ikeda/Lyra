# Mobile export reliability design (2026-08-05)

## Purpose and scope

Make the mobile app save generated page images and PDF exports through the
platform-supported iOS and Android paths. This change is limited to the mobile
client export path. It does not change API routes, authentication contracts,
stored data, generated-image data, or job payloads.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` section 2, primary flow 7: users export
  selected pages as images or PDF.
- `docs/Lyra_Unified_Spec_v4.md` section 5: production images use authenticated
  export or short-lived signed delivery.

## Design

- Page-image saving always downloads the authenticated image directly to a
  native temporary file, then registers that local file with
  `expo-media-library` via `MediaLibrary.Asset.create`. It must not convert a
  React Native `Blob` into a JavaScript byte array. That conversion has
  different runtime support from browser and native Expo environments and was
  the remaining inconsistent page-save path.
- Image saving requests add-only Photo Library access and uses the existing
  iOS usage descriptions / Android media-library configuration. A failure to
  register the downloaded local file is reported as an image-save failure, not
  as a completed download.
- Image saving validates the downloaded file signature, rather than trusting
  only the HTTP Content-Type or the temporary filename, and renames the local
  file to match PNG, JPEG, or WebP before passing it to the platform photo
  library. A non-image response is rejected, and an authenticated 401 or 403
  response refreshes the Cognito ID token once before failing.
- On Android, a PDF export is copied as Base64 into a user-selected directory
  through the Storage Access Framework. This creates a user-visible document in
  the folder selected by the user and avoids relying on a share target to
  persist the file.
- On iOS, PDF export uses the system share sheet with the PDF UTI. iOS does not
  permit an app to silently choose a Files destination; the system-supported
  user flow is to select `Save to Files` in that sheet.
- PDF downloads likewise require a `%PDF-` file signature. This accepts valid
  signed exports served as `application/octet-stream`, while rejecting an HTML
  error document even if an intermediary labels it as a PDF.
- URLs are HTTPS-only, response status must be 2xx, filenames are sanitized,
  and authenticated image downloads retain the bearer header. No token is
  logged or persisted by the export helper.

## Affected layers and non-goals

- Affected: `apps/mobile` download helper, page-save UI wiring, and mobile
  unit/contract tests.
- Not affected: backend routes/services/repositories, database schema,
  generation jobs, credit logic, and web UI.

## Test and verification plan

1. Add failing tests that require page saving to avoid Blob conversion and
   require Android PDF saving through the Storage Access Framework.
2. Verify direct authenticated image download, file-signature detection,
   photo-library permission, native asset registration, iOS PDF sharing,
   Android PDF folder selection, cancellation, storage, and network errors.
3. Run focused mobile tests, mobile typecheck/lint/export, then the broader
   repository checks appropriate for the mobile-only change.
4. Build only after the checks pass. On physical devices, verify: generated
   image appears in Photos; Android PDF appears in the selected folder; iOS PDF
   is saved through `Save to Files` and opens from Files.

## Delegation and git baseline

Terra performs a read-only inspection of the installed Expo and React Native
platform contracts. Sol owns the design, tests, integration decision, and
release verification.
The worktree already contains unrelated user changes in documentation, a
script, root `app.json`, and `store-assets/`; they are excluded from this work.
The existing safe branch is `fix/mobile-export-reliability`, so no checkout,
pull, reset, or branch switch is performed.
