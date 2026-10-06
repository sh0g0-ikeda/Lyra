# Web session render compatibility

## Scope and design

The authenticated console loads `GET /api/me` for optional image-delivery and
Google identity-link controls. The shared browser fixture previously returned an
empty object for that request. Reading `data?.user.id` after that response arrived
threw during render and replaced every authenticated screen with the error boundary.

Under Unified Spec §§4, 10 and 11, missing session identity must leave the optional
identity-link control unavailable without breaking existing editing and billing.
Guard both the session and its user before reading the ID. Keep all server
authorization, Cognito configuration and Google capability checks unchanged;
missing capabilities must never enable image delivery or identity linking.

## Verification

- Make the shared smoke fixture return the current `/api/me` contract and explicit
  disabled Google capabilities. Wrap route handlers so Playwright's second
  `Request` argument is not passed as fixture options.
- Add browser regressions for missing and null session users that still open and
  edit a work, while identity linking remains hidden.
- Capture uncaught page errors and the application's caught render-failure log in
  every smoke test so CI reports the error instead of only detached controls.
- Run Web lint/build, the existing Web unit regressions, and Playwright when the
  execution environment supports Chromium.

Only synthetic browser fixtures are recorded by these diagnostics. There are no
API, data persistence, auth permissions, payment or production configuration changes.

Local verification: Web lint and production build passed, all 113 Web unit tests
passed, and the smoke file passed a direct TypeScript check. Playwright discovered
16 tests. Chromium could not start in the cloud execution sandbox because its
socket creation returned `EPERM`; browser execution must be verified by CI.
