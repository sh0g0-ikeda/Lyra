# Mobile Android manifest permission hardening

## Purpose and scope

The release-candidate AAB artifact exposed notification, launcher-badge, wake,
and legacy shared-storage permissions even though push notifications are disabled
for the initial release. Remove those permissions from the generated Android
manifest without changing visible UI, navigation, downloads, API contracts,
backend behavior, or persisted data.

This follows `docs/Lyra_Unified_Spec_v4.md` verification and least-privilege
requirements and the initial-release boundary in
`docs/mobile-release-task-list-2026-07-30.md`.

## Impacted layer and interfaces

- Mobile build metadata only: `apps/mobile/app.json`.
- No Route, Service, Repository, Domain, Infrastructure, Worker, Web, DB, or API
  changes.
- Image and file saving continues through Android Storage Access Framework and
  the share sheet, so it does not require legacy external-storage permission.
- The dormant push implementation remains source-compatible but cannot register
  or receive notifications in this release because its feature flag is already
  false and its native permissions are removed.

## Security and review effect

- Remove `POST_NOTIFICATIONS`, FCM receive, boot, wake, vibration, and launcher
  badge permissions while the push feature is out of release scope.
- Remove `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`; the generated AAB
  limited them to API 32 and below, but the active save flow uses the user-picked
  Storage Access Framework destination instead.
- Preserve network, biometric, billing, and install-referrer declarations used by
  active release functionality.

## Verification

1. Add a failing metadata test that requires every out-of-scope permission to be
   present in `blockedPermissions`.
2. Resolve the production Expo config and run Mobile test, typecheck, lint, and
   both platform exports.
3. Build a fresh production AAB and use `bundletool validate` plus manifest dump
   to confirm package, target SDK, version code, signature, and permission set.
4. Do not mark Play App Links signing as complete until the Play App Signing
   certificate is checked in Play Console.

## Delegation

No delegation: this is a bounded build-metadata correction discovered from the
final artifact. The earlier independent review already covers the surrounding
mobile flows; the remaining work is one config list, its contract test, and a
fresh artifact inspection.
