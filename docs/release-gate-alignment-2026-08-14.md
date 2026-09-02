# Release gate alignment for Web save rollout

## Purpose and scope

PR 186 cannot enter the production rollout while two inherited release gates
fail. This change aligns the legacy migration-history expectation with the
already-added migration 041 and updates only the Expo 57 patch releases required
by `expo install --check`. It does not change migration SQL, billing behavior,
mobile features, or the Web save contract.

## Spec basis

- Unified Spec section 10 requires Vitest, migration/invariant, backend build,
  frontend, Playwright, and production rollout gates to pass.
- Unified Spec sections 5 and 7 require migration history and mobile billing
  persistence to remain deterministic.

## Affected layers

- Tests: the legacy 024-032 forward-migration history includes migration 041.
- Mobile dependency metadata: Expo patch versions and the npm lockfile only.
- No Route, Service, Repository, Domain, Worker, database schema, or Web runtime
  behavior changes.

## Security and data integrity

Migration 041 remains immutable. The integration test must prove that a legacy
database applies it in the expected ordered forward set. Dependency updates are
restricted to Expo-recommended patch releases; no credentials or production
configuration are changed.

## Verification

1. Reproduce the two failing GitHub checks from PR 186.
2. Update the migration expectation and exact Expo patch-compatible packages.
3. Run the migration-history integration test against PostgreSQL.
4. Run `expo install --check`, Expo Doctor, Mobile typecheck/lint/tests/exports,
   the full repository CI gates, Web build, and Playwright.
5. Re-run GitHub Actions and proceed only when all checks pass.

## Orchestration

Sol owns this release-blocker fix and all production operations. Terra remains
read-only and reviews the Web save commit; no deployment or secret handling is
delegated.
