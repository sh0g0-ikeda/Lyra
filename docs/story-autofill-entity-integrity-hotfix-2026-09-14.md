# Story autofill / Web character revision hotfix

## Design and scope

Approved objective: correct the September 14 story-autofill provider-output failure,
its misleading input-error presentation, and the Web reference-delete/save conflict.
Preserve existing manga data, drafts, concurrency checks and released Mobile clients.
Spec basis: Unified Spec sections 2–6, 8–10 (workflow, tenancy, generation, output
validation, availability, verification). No schema migration, model migration,
credit rule change, or native UI/release is planned.

The isolated branch starts from 8f84ed4 (runtime c287186), matching API task 130.
The root worktree is dirty and must remain untouched. Worker task 73 uses 3f160ba;
its affected compiler and PageService sources match c287186. Build overlays against
each exact deployed image, preserving unrelated production code and configuration.

## Interfaces and invariants

- Infrastructure / Service: trusted entity IDs come from the authorized database
  context, never from client-supplied IDs or parsing narrative text. Constrain and
  validate both panel assignments and dialogue speakers before any persistence.
  Invalid output must not silently invent, substitute or discard a character.
  Keep the complete cast, including large casts; do not truncate an enum to meet
  provider schema limits. Retain UUID, cross-context and atomic persistence gates.
  Sol reviewed the design: use one shared enum definition for 1–200 IDs, UUID
  format for larger casts, and the complete allowlist in Zod for every response.
  With no cast, speakers must be null and assignments empty. Retry only a typed
  `invalid_payload` once with identical request settings, after the execution
  control checkpoint. Refusal, HTTP/timeout and incomplete responses do not gain
  retries. OpenAI schema limits were checked against its official Structured
  Outputs guide on 2026-09-14 (1000 enum values total; 15000 string characters for
  an enum with more than 250 values). The conservative 200-ID threshold and a
  single `$defs` avoid depending on the full schema's remaining enum budget.
- Route: known AI structured-output failures use an existing safe provider-error
  code/message key understood by Web and Mobile. Actual user-input validation
  keeps its existing classification. Raw provider messages remain private.
- Web: capture session, organization, work, entity and pre-delete persisted fields
  before deleting a reference. Fetch the entity in that same scope after success.
  Adopt the revision only when persisted editable fields did not change. Preserve
  the latest local draft (including typing during the request), not just the draft
  at click time. Late responses cannot alter another scope/entity. A concurrent
  editable-field change or failed reload must retain the draft and block a blind
  generation retry. Deletion itself remains committed; do not resurrect the image.

## Validation and ownership

Sol reviews design and the integrated result. Terra owns Web App wiring, a narrowly
scoped helper if needed, and Web regression tests. Parent owns backend tests/code,
this note, integration and production operations. One writer per file.

Write failing regressions first: invalid/foreign UUID output, empty/large cast,
safe error classification and Mobile response schema, reference deletion followed
by generation, typing during deletion, conflicting edits and late/failed responses.
Retain existing cancellation, input fingerprint and all-or-nothing persistence
tests. Then run Vitest, Bun entrypoints, PostgreSQL migrations/invariants, backend
build, Web lint/build and Playwright smoke. Check released Mobile contract/types
and relevant tests independently of the older backend-base native dependencies.

## Release and rollback

Before release, review the diff and record tests and exact artifact hashes. Preserve
API/Worker environment, secrets references, roles, architecture and queue settings.
Inspect active jobs before Worker rollout. Verify readiness, targets, rollout,
queues and new logs, plus available non-chargeable functional checks. Stop/rollback
on new readiness, authorization, job processing or persistence regressions.
Rollback targets at design time: API 130 and Worker 73; recheck live revisions just
before deployment. Do not declare a live AI generation verified from mocked tests.

## Review and local evidence

- TDD: 11 provider/route regressions and two Service forwarding regressions failed
  on the original implementation. The initial focused suite passed 96 tests after
  the fix. Added refusal, incomplete output, invalid context, and real-compiler
  double-failure/no-persistence cases also pass.
- Backend final Vitest: 1,678 passed, four DB tests reserved for the PostgreSQL
  gate. An initial unlimited-worker run hit one Sharp test timeout; the complete
  rerun with two workers passed without test or timeout changes.
- Bun entrypoint: 26 passed. Backend TypeScript build and Mobile contract, API
  inventory and Web parity inventory checks passed.
- Current Mobile 1.0.7 source remains unchanged. Typecheck and 47 targeted API/job/
  save compatibility tests passed. Its first full run had timing-sensitive UI
  failures under local load; the final full run with one worker passed all 710
  tests in 136 files, without modifying Mobile source or tests.
- Sol reviewed the backend and release utility. The Web review additionally caught
  late-error scope leakage and a draft snapshot restoration race; the final design
  skips hydration using a revision marker, preserving current React draft state.
- Existing optional dialogue speaker default remains compatible; strict provider
  schema requires the field, and explicit malformed/foreign IDs cannot be repaired
  into null or another character by this change.
- Local Docker cannot start due to its existing `dockerInference` socket. No Docker
  data reset was performed. Use the CI PostgreSQL/migration/container gates and
  actual ECS one-off image probes. OCI overlays preserve each deployed base layer
  and runtime Config; the prepared/pushed utility, sources and files are hashed.
  Preserve production `.well-known` association files and prior hashed Web assets.
- First CI run 34804684141 passed PostgreSQL migrations/invariants, backend build,
  ARM64 migration image build/probe, and Web lint/build. Browser tests found one
  inaccurate test fixture (button accessible name and missing reference-set route),
  corrected without changing application behavior before rerunning the gate.
  The final direct Playwright JSON report confirms 28 passed, zero failed,
  skipped or flaky tests. Production Web build used the verified live Cognito
  settings, organization flag and Apple team ID; the bundle is index-BjQkQ4Ew.js.
- The separate `mobile-verify` job fails at Expo dependency compatibility on the
  old backend source base (Expo 57.0.13 versus currently recommended patches).
  No Mobile dependency or source is part of this runtime overlay. The actual
  Mobile 1.0.7 checkout passed typecheck and all 710 tests. This is a scoped
  baseline exception; do not describe the entire PR as having all CI jobs green.
