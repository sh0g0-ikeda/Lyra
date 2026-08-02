# Page design job recovery design

## Purpose and scope

- Make page-skeleton generation finish as a skeleton-only operation.
- Keep the accepted skeleton or story-autofill job visible and active even if local job-history persistence or query invalidation fails.
- Keep the terminal job result visible so completion is unambiguous without restarting the app.
- Prevent story autofill from rewriting page-layout metadata.
- Open authenticated legal and support HTTPS links without relying on Android package-visibility probing.

This change does not move or recolor UI, change request or response schemas, add migrations, change credit handling, or change page, panel, or frame identifiers, ordering, or counts.

## Specification basis

- Unified Specification section 2 defines skeleton generation and story application as consecutive, separate steps.
- Unified Specification section 6 requires persistent asynchronous job states and makes page and panel identity, order, and panel count immutable during autofill.
- Story AI Sub-Specification sections 5 and 6 require story content to fill existing editable fields and validate page and panel coverage.

## Affected layers and interfaces

- Mobile: `PagesScreen` request options and accepted-job lifecycle; `JobStatusCard` polling; Account external-link launch.
- Service: episode story-autofill preflight validation.
- No Route, Repository schema, Domain contract, Infrastructure provider, queue, credit, or migration changes.

The existing APIs remain:

- `POST /api/episodes/:id/generate-page-skeleton`
- `POST /api/episodes/:id/autofill-pages-from-story`
- `GET /api/jobs/:id`

Skeleton generation will send `apply_story_plan: false`. Story autofill will continue to update page story fields, panel content, dialogue, and entity assignments atomically, but will not persist a repaired `layout_config`.

## Safety and security

- Existing authentication, organization authorization, active-job uniqueness, rate limits, cancellation, and input schemas are unchanged.
- Existing page and panel ownership checks remain in repository calls.
- Autofill still rejects a mismatch between persisted panel count, frame count, and layout metadata before calling the model. It does not silently repair or rewrite the layout.
- The atomic locked-episode persistence and input fingerprint check remain unchanged.
- Accepted background work is not reported as stopped merely because optional local tracking or cache invalidation failed.
- External links remain restricted to parsed HTTPS URLs. The app calls the platform URL launcher directly because Android can reject `canOpenURL` package-visibility checks even when the browser can open the URL.

## Test plan

1. Add a mobile contract regression test that requires skeleton-only payloads and resilient accepted-job follow-up.
2. Change the PageService regression test to require layout metadata to remain unchanged while content autofill succeeds.
3. Add an Account regression test proving a reachable HTTPS legal link opens without a `canOpenURL` preflight.
4. Run each changed test first and confirm it fails before implementation.
5. Run mobile unit tests, typecheck, lint, API contract checks, backend unit tests and build.
6. Run repository release gates before merge and deployment.

## Terra delegation

Terra performs read-only inspection of the current mobile request and state paths. Sol owns design, implementation, backend safety review, integration, and final verification.
