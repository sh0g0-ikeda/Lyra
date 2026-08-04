# Mobile image save and stale-job recovery design (2026-08-04)

## Objective and scope

Restore the existing per-image **Save image** control on Android and iOS so it
uses the authenticated export flow reliably.  Suppress only stale job-history
cards whose referenced job has already been deleted; do not suppress genuine
errors for other product operations.

Out of scope: changing the page, image, job, or billing data structures;
changing backend routes; changing the visual placement of the existing save
control; or removing image export.

## Contract and spec basis

- Unified Spec v4, user flows for page image/PDF export.
- Unified Spec v4, authenticated production image delivery: exports must use
  authenticated access or a short-lived URL.
- Unified Spec v4, jobs: an unavailable historical job must not cause an
  unrelated active flow to retry indefinitely.

## Current failure

The native direct-download helper receives a snapshot `Authorization` header
and downloads `/api/pages/:id/export-image` outside the API client's auth
retry path.  A stale Cognito token can therefore receive 401/403/404.  The
helper currently translates those failures into the misleading generic
`DOWNLOAD_INTERRUPTED` message.  Android and iOS share this code path.

Separately, `JobStatusCard` displays and continually retries a 404 job query,
which surfaces the misleading "target data was not found" card for a stale
job identifier.

## Design

1. Keep the existing native media-library write mechanism, but add a helper
   that writes an already authenticated `Blob` to the app cache and saves it
   to the photo library.
2. In `PagesScreen`, retrieve the image with `MobileApiClient.exportPageImage`.
   That client refreshes the Cognito token and retries once on 401, then passes
   the returned `Blob` to the new helper.  No API, schema, or backend contract
   changes are required.
3. Preserve explicit HTTP failure information rather than recasting it as an
   interrupted download.  Existing individual-image save UI remains visible.
4. Treat a 404 from a background historical-job lookup as terminal and render
   no job error card.  Do not apply this suppression to explicit user-requested
   API operations.

## Security and compatibility

- Image bytes continue to come from the existing ownership-scoped export route.
- Token refresh remains centralized in `MobileApiClient`; no token is stored
  or logged by the file writer.
- The page/export request and returned blob format are unchanged.
- Cache writes use a generated, extension-preserving filename and do not use
  user input as a filesystem path.

## Test and verification plan

1. Add focused tests first for blob-backed photo-library saving and stale 404
   classification; observe their failure before implementation.
2. Run the focused mobile tests, typecheck/lint, and mobile build checks.
3. Review the resulting diff for route, data-contract, and unrelated-worktree
   changes before commit and push.
4. Build Android and iOS only after the checks pass.  Confirm a fresh Android
   APK on device can save a generated image, rather than inferring success from
   a successful build.

## Delegation decision

No additional implementation delegation: the change crosses authenticated
export, native filesystem behavior, and release verification, so one owner
will make and review the compatibility decision.  Independent review remains
part of the verification gates above.
