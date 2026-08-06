# Mobile Expo patch compatibility and release plan

Date: 2026-08-06

## Purpose and scope

Align the Expo SDK 57 patch dependencies that `expo install --check` requires,
then create release artifacts containing the already-verified mobile save,
image-import, and store-billing UI fixes. This change updates only the five
Expo packages reported by the compatibility checker and their lockfile entries.

It does not change mobile purchase product IDs, server-side purchase validation,
Stripe web APIs, database schemas, credit calculations, or enable
`MOBILE_STORE_BILLING_ENABLED`.

## Spec basis

- Unified Spec section 7: purchases and credit grants remain server-authoritative.
- Unified Spec section 9: release operations must preserve the availability
  contract; dependency upgrades are verified before release artifacts are made.
- Unified Spec section 10: release verification is completed proportionately
  before distribution.

## Affected layers and interfaces

- Mobile dependency/runtime layer: `apps/mobile/package.json` and its lockfile.
- Mobile build/release operations: EAS production iOS, Android AAB, and internal
  Android APK profiles.
- No Route, Service, Repository, Domain, Worker, database, or external billing
  interface changes are in scope.

## Security and release controls

- Do not expose or alter secrets, payment credentials, store product identifiers,
  or runtime billing flags.
- Build only from the committed, validated branch head.
- Submit only the newly created iOS production build; do not use a prior build
  selected by `--latest` without verifying its commit and build number.
- Do not submit Android to Google Play in this task. The AAB is produced for the
  closed-test operator to review before Play Console release actions.

## Test plan

1. Confirm the current compatibility check fails for the five reported patch
   mismatches.
2. Use Expo's package resolver to update exactly those packages and lockfile.
3. `expo-sharing@~57.0.10` is referenced by the Expo 57.0.11 compatibility map
   but is not published to npm; use the newest published `~57.0.9` and list
   only that package in `expo.install.exclude` with this documented reason.
4. Confirm `expo install --check` passes.
5. Run Mobile typecheck, lint, full Vitest suite, contracts, mojibake check, and
   iOS/Android exports.
6. Commit and push the dependency update. Only then run EAS production builds.

## Terra delegation

Terra performs a read-only EAS profile and remote build/submission audit. Sol
owns dependency changes, validation, release decisions, production builds, and
submission.
