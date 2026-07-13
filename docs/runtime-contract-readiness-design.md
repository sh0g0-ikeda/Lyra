# Runtime contract and readiness hardening design

## Purpose

This change prevents a partial API response or an unavailable database from being
misreported as a healthy, usable application. It also makes the browser smoke test
part of the normal CI contract.

## Scope and compatibility

- Keep `GET /healthz` as a process-liveness endpoint. Existing ECS health checks do
  not change behavior.
- Add `GET /readyz` for dependency readiness. It performs a bounded `SELECT 1` and
  returns only a generic availability result; database details are never exposed.
- Keep the billing API response shape. The web client accepts the current complete
  response and the older response that omitted `plan_code` and
  `subscription_plans`. Unknown future plan codes render as an unknown plan instead
  of crashing the application.
- Add a React error boundary as the last-resort recovery UI. Expected API contract
  variation is handled before rendering, so the boundary is not the primary control
  flow.
- Update Playwright fixtures to match the current UI and API contract, then run the
  browser smoke test in CI.
- Add a PostgreSQL service to CI and apply migrations plus deployment invariant
  checks against it. Unit tests remain independent of Docker and PostgreSQL.

## Layer responsibilities

### Web contract boundary

`apps/web/src/lib/billingContract.ts` owns plan-code validation, fallback labels,
and plan ranking. `App.tsx` consumes these helpers and does not index label maps with
untrusted API values.

### Web recovery boundary

`AppErrorBoundary` catches unexpected render failures, records the technical error
in the browser console, and shows only a user-actionable reload message. It does not
display stack traces or raw API data.

### Readiness route

`createHealthRoutes` receives a small `ReadinessCheck` function. Production wiring
uses the shared database client, while tests inject deterministic success and
failure checks. The route does not own database configuration.

### CI database verification

CI starts PostgreSQL 16, waits for health, runs all migrations against a disposable
database, and executes the existing deployment invariant checker. No production
credentials are used.

## Error and security behavior

- A missing billing plan is treated as the legacy free-plan response only at the
  display boundary.
- An unknown non-empty plan code is displayed as unknown and receives no upgrade
  rank privileges.
- Readiness failures return HTTP 503 with `{ "status": "unavailable" }`; exception
  text and connection details stay in server logs.
- Readiness and liveness are explicitly public and exempt from browser origin
  enforcement. They expose no user data.
- The CI database uses throwaway credentials scoped to the workflow service.

## Test cases

- Known, missing, and unknown billing plan codes.
- Root render failure presents recovery UI instead of a blank page.
- `/healthz` remains 200 without touching the database.
- `/readyz` returns 200 on database success and 503 on failure.
- Auth screen and authenticated console Playwright smoke paths.
- Authenticated console remains usable with a legacy billing response.
- Migrations and deployment invariants run against real PostgreSQL in CI.

## Source-of-truth note

The repository does not contain historical copies of
`docs/Lyra_Unified_Spec_v4.md` or `docs/Lyra_StoryAI_SubSpec.md`. Until reconstructed
and reviewed, current migrations, route schemas, service interfaces, and tests are
the executable source of truth. This change adds those named documents separately
as indexes to the current implementation; it does not invent incompatible product
behavior.
