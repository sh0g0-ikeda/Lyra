# Mobile review compliance hardening design

## Purpose and scope

Close the remaining code-controlled Apple App Review and Google Play rejection
risks without changing Lyra's story, page, generation-job, credit, ownership, or
persistence contracts.

This change will:

1. replace the Sentry-only AI-content report delivery path with an authenticated,
   bounded Lyra API endpoint that records a privacy-minimized structured operational
   event and returns a receipt identifier;
2. keep Sentry crash diagnostics optional so a missing DSN cannot replace the whole
   production app with a configuration-error screen;
3. hide the asynchronous PDF/ZIP controls unless the matching Mobile runtime flag is
   enabled, while preserving the existing single-page image save action;
4. hide organization invoice links together with the other external billing actions
   in Mobile, without changing Web or Backend billing behavior;
5. use the already-registered `lyra-mobile://` OAuth callback for store builds and
   omit the unverified iOS associated-domain entitlement, while retaining Android
   HTTPS App Links for invitations; and
6. align store copy and review documentation with the features that are actually
   enabled in the submitted artifact.

Out of scope: enabling mobile store products, changing prices, provisioning reviewer
accounts, App Store Connect or Play Console form submission, Apple Team membership,
new export infrastructure, DB migrations, worker changes, UI relocation, color
changes, and any modification to generated story/page data structures.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: preserve the existing authenticated
  manga-production and single-page image-export flows.
- Sections 3 and 8: Route validates HTTP input, Service owns the reporting workflow,
  Infrastructure emits the operational event, and Mobile consumes a stable API
  contract; authentication, bounded input, and safe output are mandatory.
- Section 4: AI reports require an authenticated user and never create an
  ID-knowledge authorization path into another tenant's content.
- Sections 7 and 9: billing and export runtime defaults remain fail-closed; no credit,
  generation queue, or export-worker behavior changes.
- Section 10: focused TDD precedes implementation, followed by Mobile, Backend, Web,
  contract, build, and release checks.

## Affected layers and interfaces

- Route: `POST /api/ai-content-reports`, authenticated and rate limited.
- Service: validates the fixed report vocabulary, assigns an opaque report UUID, and
  forwards only bounded metadata to a sink.
- Infrastructure: writes one structured `ai_content_report_received` event to the
  production API log stream; no prompt, generated text, image URL, email, token, or
  provider response is recorded.
- Mobile: calls the authenticated API from the existing report button and displays
  success only after a `202` receipt; Sentry remains optional crash diagnostics.
- Mobile configuration: adds an explicit default-off episode-export visibility flag.
- Mobile release configuration: OAuth callback uses the registered custom scheme;
  iOS associated domains remain absent until a valid AASA can be published.
- Web/Backend billing: unchanged. Only the Mobile rendering of external invoice URLs
  is suppressed.
- Persistence, migrations, workers, generation jobs, and credit ledger: unchanged.

Request:

```json
{
  "content_kind": "generated_image | story_proposal",
  "content_id": "optional UUID",
  "reason": "unsafe_or_inappropriate"
}
```

Response: HTTP `202` with `{ "report_id": "UUID", "status": "received" }`.

## Security and operational controls

- Authentication and the existing authenticated API rate limiter are mandatory.
- The route never dereferences `content_id`; therefore it cannot disclose whether a
  resource exists in another tenant. The identifier is correlation-only.
- Zod uses a strict object and fixed enums; IDs and response shapes are bounded.
- The event contains the authenticated opaque user ID, opaque content ID when
  supplied, fixed category/reason, request ID, report ID, and timestamp only.
- Raw generated content and provider errors never enter the report payload or log.
- Review operations use the report ID to search retained API logs and feed confirmed
  incidents into prompt/provider filtering; the moderation runbook documents this.
- Missing Sentry configuration disables diagnostics but does not disable the product
  or the server-backed reporting path.

## Test-first plan

1. Backend route tests first fail for the missing endpoint, then cover authentication,
   strict validation, `202` response, and no generated-content fields.
2. Service tests first fail for the missing service, then cover receipt creation and
   privacy-minimized sink input.
3. Mobile API/button tests first fail for the missing API call, then cover Bearer auth,
   exact payload, success, failure, and absence of prompt/image data.
4. Configuration tests first fail until production accepts an empty Sentry DSN and
   episode export defaults off.
5. UI tests first fail until PDF/ZIP is gated and Mobile invoice links are hidden.
6. Expo configuration tests first fail until store builds omit iOS associated domains
   and use the registered custom-scheme callback.
7. Run focused tests, Mobile typecheck/lint/contracts/tests/Android+iOS export, root
   tests/build/invariants, Web lint/build, and applicable Playwright smoke tests.

## Sol / Terra delegation

- Sol owns this design, integration, policy decisions, final review, release gates,
  PR/merge, deployment decisions, and the repeated post-fix reviewer audit.
- Terra backend worker owns only the AI-report Route/Service/Infrastructure wiring and
  focused Backend tests.
- Terra Mobile report worker owns only the API client, existing report button,
  observability/config policy, and their focused Mobile tests.
- Terra Mobile review worker owns only invoice/export rendering, Expo/EAS callback
  configuration, store copy, and focused tests.
- No Terra agent may run production operations, edit unrelated paths, add secrets, or
  alter generation, story, page, credit, billing verification, or worker contracts.

## Review iteration 2: private-workspace safety and affirmative terms

The first post-implementation Apple/Google audit found three additional
code-controlled review risks. They are addressed without changing generated data,
workspace persistence, billing, or the generation pipeline:

1. Add an authenticated, membership-scoped organization safety-report endpoint and
   two in-app actions: report inappropriate workspace content and report a member.
   The endpoint records only the organization ID, authenticated reporter ID, fixed
   target/reason enums, request ID, report ID, and timestamp. It never stores raw
   content or accepts a target user's identifier. Existing organization membership
   authorization is mandatory before receipt creation.
2. Gate the authenticated Mobile application behind explicit acceptance of the
   current Terms version. Acceptance is stored per authenticated user in SecureStore;
   changing the version requires acceptance again. This is a Mobile submission gate,
   not a new backend persistence contract, and it does not alter content creation or
   upload APIs.
3. Keep the sole-organization-owner account-deletion recovery path inside the app by
   opening the existing organization-management UI instead of the Web application
   root. Existing subscription management through the official Apple/Google system
   settings remains accurately described in reviewer notes.

The organization report request is a strict object:

```json
{
  "organization_id": "UUID",
  "target_kind": "workspace_content | member",
  "reason": "unsafe_or_inappropriate"
}
```

It returns HTTP `202` with the same opaque receipt shape as an AI-content report.
Tests are added before each implementation: route authentication/validation and
membership authorization, privacy-minimized logging, Mobile API/button behavior,
per-user versioned Terms gating, and the in-app account-deletion recovery action.
Sol retains integration/security decisions; Terra may implement only the bounded
Backend organization-report slice or the bounded Mobile organization-report slice.
