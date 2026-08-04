# Mobile image-save recovery design (2026-08-04)

## Purpose and scope

Restore the existing individual **Save image** control on Android and iOS.  The
scope is page-image persistence to the device photo library only; it does not
change the page generation pipeline, page data model, PDF export, or billing.

## Specification basis

`Lyra_Unified_Spec_v4.md` sections 2 and 5 require authenticated page-image
export while keeping the stored image opaque and ownership-scoped.  A download
must therefore continue to use the existing authenticated export endpoint.

## Failure being addressed

The screen passed a snapshot of the Cognito authorization header directly to
`FileSystem.downloadAsync`.  When that header had expired, the native transfer
could not use `MobileApiClient.fetchWithAuthRetry`, so an otherwise recoverable
authentication failure was presented as an interrupted download.

## Chosen interface

1. `PagesScreen` calls `MobileApiClient.exportPageImage(pageId, organizationId)`.
2. The API client refreshes its credential when necessary and returns a `Blob`.
3. `saveImageBlobToPhotoLibrary` writes the blob to the app cache as Base64,
   requests photo-library permission, and saves that local file.

No route, persisted field, image key, ownership rule, or external API contract
changes.  The legacy multi-source native downloader remains for unrelated
callers, but page-image save no longer gives it a stale authorization header.

## Security and error handling

The binary is requested from the same authorization-scoped API endpoint used by
the browser export.  The cache filename is normalized before writing.  Photo
library denial and storage failure stay distinct from network/download errors.

## Verification

- Unit test: API-returned binary becomes a normalized local PNG and is saved to
  the photo library without a direct native network transfer.
- Screen contract test: page save uses `api.exportPageImage` and keeps its
  user-visible save-image control.
- Release checks: mobile tests, typecheck, lint, contract check, platform
  exports, then Android and iOS store builds.

## Integration ownership

No Terra delegation is used for this release fix.  The affected screen, mobile
download helper, Expo dependency baseline, and store build are a single
authentication-sensitive delivery path, so splitting ownership would add
integration risk without creating a safely independent sidecar.
