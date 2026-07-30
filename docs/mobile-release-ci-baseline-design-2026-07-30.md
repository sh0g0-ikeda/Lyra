# Mobile Release CI Baseline Remediation

## Purpose and scope

- Restore the existing `feature/mobile-completion` CI baseline so the Mobile guide
  change can be reviewed independently and the native application can pass its
  release checks.
- Update only Expo-compatible patch versions and the generated backend route
  inventory reported by CI.
- Do not change Mobile screen behavior, API implementations, persistence,
  generation jobs, billing, migrations, or production runtime configuration.
- Keep the responsive Web release separate from this maintenance change.

## Specification basis

- Unified Spec section 3: keep dependency compatibility inside the Mobile client
  and keep generated route inventory aligned with the existing Route boundary.
- Unified Spec section 8: do not weaken validation or expose runtime details while
  updating build dependencies.
- Unified Spec section 10: Mobile compatibility, generated contracts, tests,
  exports, backend checks, and browser checks must pass before release.

## Affected layers and interfaces

- Mobile build tooling: Expo, React Native, and Expo lint configuration patch
  versions only.
- Documentation/contract inventory: regenerate the backend route inventory from
  the current checked-in routes.
- Web, Route behavior, Service, Repository, Domain, Infrastructure, Worker, Ops:
  unchanged.
- Inputs, outputs, API payloads, database schema, job messages, and error contracts:
  unchanged.

## Failure evidence and implementation

The failing GitHub Actions run stopped before tests:

1. `npx expo install --check` reported eight packages below the patch versions
   required by the installed Expo SDK.
2. `bun run mobile:api-inventory:check` reported that the generated backend route
   inventory was stale.
3. After those gates passed, `bun run mobile:web-parity:check` reported that its
   generated inventory still described the pre-move Page controls.

Use Expo's installer to select SDK-compatible versions and its lockfile changes.
Regenerate the route and Mobile/Web parity inventories with the repository-owned
audit scripts. Reject any unexpected source or API behavior changes during diff
review.

## Security and rollout

- No secrets or environment values are changed or recorded.
- Dependency updates remain within the current Expo SDK and React Native minor
  line; no framework-major migration is included.
- Generated inventory remains documentation-only and must match the route parser.
- Merge this maintenance PR into `feature/mobile-completion` before re-running the
  guide PR. Do not use it as authorization to publish the entire draft Mobile
  feature branch to stores.

## Test plan

The two CI commands already fail on the unchanged base for the expected reasons.
After implementation run:

1. `npx expo install --check` and `npx expo-doctor`.
2. `bun run mobile:api-inventory:check` and Mobile generated-contract checks.
3. Mobile typecheck, lint, full Vitest suite, mojibake check, Android export, and
   iOS export.
4. Repository Vitest/Bun, migration/invariant, backend build, Web lint/build, and
   Playwright through GitHub Actions before merge.

## Delegation

No delegation. Active collaboration policy disallows sub-agents unless explicitly
requested, so the Sol/Terra task packet is executed locally. Final dependency,
integration, and production deployment decisions remain with Sol.
