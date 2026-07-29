# Lyra Mobile Completion Implementation Design

## Purpose and scope

`docs/mobile_completion_gap_spec.md` is the completion contract for `apps/mobile`
and the backend capabilities required by the mobile application. Work proceeds in
the specification's Phase 0 through Phase 5 order and is complete only after Audits
A through D and the release gate have no open P0 or P1 item.

In scope:

- Mobile repository recovery, tests, CI, and release configuration
- Shared API schemas and response validation
- Authentication recovery, deep links, invitations, and account deletion
- Personal and organization tenancy, capabilities, credits, and billing
- Story, entity, page, panel, export, and generation workflows
- Jobs, offline recovery, i18n, accessibility, and observability
- Backend routes and services explicitly required by the mobile completion spec

Out of scope:

- Wrapping the Web application in a WebView
- Mobile-only emulation of backend behavior that does not exist
- Changing generation models or compiler prompts
- Production submission before every release gate is proven

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` sections 2 through 10
- `docs/mobile_completion_gap_spec.md` sections 4 through 14
- `docs/Lyra_StoryAI_SubSpec.md` for StoryAI and skeleton/autofill changes

Where the gap document requests a backend contract, the Unified Spec architecture,
tenancy, generation-job, credit, safety, and verification sections remain the
controlling constraints.

## Layers and interfaces

- Mobile: screens, state, navigation, storage, API adapter, runtime schemas, native
  purchase/deep-link adapters, and tests
- Route: authenticated HTTP input, bounded validation, role checks, and stable errors
- Service: account deletion, purchases, generation readiness, atomic save-and-generate,
  exports, and job lifecycle workflows
- Repository: tenant-scoped persistence, idempotency, outbox/job transitions, ledger
  updates, and hidden-history state
- Infrastructure: Apple/Google verification, notifications, push, S3/export, and Cognito
- Ops: CI, EAS profiles, association files, privacy/store metadata, and release evidence

Mobile request and response data is parsed at the API boundary. Organization IDs may
only come from the authenticated session membership. Chargeable operations remain
server-authoritative and never grant credits from a browser return or client receipt
alone.

## Security controls

- Preserve personal ownership and active-organization membership scope on every resource
- Enforce role capabilities on both UI and backend; UI hiding is not authorization
- Validate bounded request bodies and provider responses
- Use parameterized SQL and opaque storage keys
- Keep purchase verification, ledger updates, refunds, and job enqueue idempotent
- Use authenticated assets or short-lived URLs and clear user-scoped caches on identity change
- Serialize provider failures to stable user-safe job errors
- Keep `.env`, store credentials, signing keys, and notification secrets out of Git

## Test and verification plan

Each behavioral slice starts with a failing test. Phase 0 may use wiring exceptions
only for Git tracking and CI YAML, where no runtime test can fail first.

1. Mobile unit tests: i18n, errors, runtime schemas, payload bounds, query keys,
   refresh mutex, selection isolation, and capability rules
2. Mobile component tests: auth recovery, hierarchy, page blockers, generation,
   billing/workspace, jobs, and destructive confirmation
3. Backend tests: authentication, validation, tenancy, role matrix, idempotency,
   refunds, safe errors, readiness, and atomic generation
4. Release checks: backend tests/build/invariants, Web lint/build/E2E, Mobile
   install/typecheck/lint/test and iOS/Android export
5. Audit A-D evidence recorded against every requirement before completion

## Sol / Terra delegation

- Sol owns this design, integration order, security and transaction boundaries,
  implementation review, final audits, and release decision.
- Terra explorer 1 audits backend/API contract gaps read-only.
- Terra explorer 2 audits Mobile UI/runtime gaps read-only.
- Terra explorer 3 audits CI/release/store gaps read-only.
- Later write delegation is limited to disjoint file sets with tests and is reviewed
  by Sol before integration.

## Git baseline

Work continues from branch `docs/sol-terra-skills` because the worktree already
contains user changes and the entire `apps/mobile` tree is untracked. Switching to
`main`, pulling, or resetting would risk those changes. Pre-existing unrelated dirty
paths are not included in Mobile completion commits:

- `.gitignore`
- `docs/cloud-current-state-2026-06-21.md`
- `scripts/createDockerLearningDocx.py`
- `docs/entity-version-derivation-design.md`
- `docs/mobile_frontend_design.md`
- `docs/story-hierarchy-tree-design.md`
- `docs/thread_handoff_2026-07-08.md`

## MOB-API-003 entity-state management slice

Purpose: expose persistent character appearance, injury, clothing, hair, expression,
and extra continuity states to the Mobile client without accepting user-entered state
identifiers. This implements the entity-state portion of `MOB-API-003` while
leaving scene deletion and Pages assignment integration to their separately owned
workstreams.

Affected layers: the scene domain/repository/service/route stack and the Mobile
API contract, query key, payload types, and Characters screen. The authoritative
basis is Unified Spec sections 2, 4, 5, and 8 plus the Mobile gap specification's
MOB-API-003 requirement.

Security: `GET /api/entities/:id/states` validates personal ownership or active
organization membership through the entity's work and requires `view_work` in an
organization. Existing create/update routes require `edit_work`; the service also
checks that a selected scene belongs to the same work as the entity. Mobile scopes
state cache keys by user session, entity, and organization. The UI offers only
state-record selection and same-work scene records, never a free-form state ID.

Testing: add a failing route test for the new list endpoint, then implement the
repository/service/route path. Add Mobile API contract and query-key tests before
adding the client methods and UI. Verify targeted backend tests, Mobile tests,
typecheck, and lint. Terra delegation is not used because this task owns a compact,
interdependent contract from backend route through the Characters screen.

Pages assignment integration uses the same tenant-scoped entity-state endpoint and
cache key. A panel assignment may select only a state returned for that assignment's
entity, through a modal radio picker with an explicit "no override" option. Raw state
IDs are never entered or displayed. This is implemented locally because it is a
small extension of the already integrated entity-state contract and does not overlap
the active Terra file ownership.

## MOB-PAGE-008/012/014 atomic generation Mobile slice

Purpose: replace the Mobile page-generation sequence of separate page, panel,
assignment, frame, and enqueue requests with the server-authoritative readiness and
atomic save-and-generate contracts. This slice does not change generation prompts or
reimplement blocker decisions in the client.

Spec basis: Unified Spec sections 4, 5, 6, 7, and 8, plus
`MOB-PAGE-008`, `MOB-PAGE-012`, and `MOB-PAGE-014`. The backend readiness helper,
transaction, credit lock, generation snapshot, durable outbox, and organization
authorization remain authoritative.

Affected interfaces: Mobile Pages state is converted into one bounded payload
containing the current page revision, page provenance, every panel and assignment,
every frame, and the selected generation language. The API client sends that payload
with an `Idempotency-Key`, parses readiness and enqueue responses at the boundary,
and scopes both routes with the selected authorized organization. A `PAGE_STALE`
response forces a server refresh and explicit review instead of retrying stale data.

Security and integrity: no S3 key, prompt, provider error, or client-calculated
credit decision is introduced. The Mobile payload builder rejects missing,
duplicate, or mismatched panel/frame relationships and never truncates panels.
Confirmed pages, permissions, active jobs, references, and credit availability are
validated by the shared backend readiness logic immediately before enqueue.

Testing: first add failing pure-function tests proving that all panels are preserved,
only the selected panel draft is merged, provenance and revision are retained, and
invalid panel/frame mappings are rejected. Then add API contract tests for response
parsing, organization scope, and idempotency headers, followed by Pages integration
tests and Mobile typecheck/lint. No new Terra task is used for this tightly coupled
slice because current Terra workers already own the adjacent shared API files.

## MOB-PAGE-015 shared layout-template contract

Purpose: remove duplicated Mobile template geometry by exposing the existing backend
domain templates through an authenticated read contract. The domain constant remains
the only source of frame geometry and Japanese manga reading order.

The endpoint `GET /api/page-layout-templates` returns stable template IDs, locale
label keys, panel counts, normalized frame vertices and reading order, a portrait
preview aspect ratio, and the supported normalized page size. It contains no
user-specific data but remains authenticated because it is an in-product API and
must not widen the public route surface.

The route test is written first and verifies both authentication and the serialized
domain geometry. Mobile response parsing, query caching, and removal of its local
geometry table follow after the active shared-API Terra task completes. Applying a
template still uses the existing tenant-scoped transactional service; this read
endpoint does not weaken edit authorization or permit implicit panel truncation.

## MOB-STORY-002/004/005/006 focused workflow correction

Purpose: keep the Story screen centered on the current episode's full story while
preserving legacy backend fields that are not part of the current Mobile workflow.
The UI stops exposing work genre/overview fields, chapter planning fields, episode
purpose, and cross-layer StoryAI controls. Existing values remain in local synced
state and are sent back unchanged when their parent record is saved; no migration or
destructive clearing is performed.

The page-skeleton action loads the episode's current pages. With no pages it enqueues
an initial generation; with existing pages it explicitly confirms and sends
`overwrite_existing:true`, including the affected page and panel counts in the
warning. The whole-story apply confirmation states that processing can take about
20 minutes and continues to use a tracked backend job.

StoryAI improvement is limited to the selected episode and applies only a normalized
full-story draft. Title and legacy purpose output are not applied to hidden fields.
The current draft can then be submitted again for another improvement. Backend
episode/work authorization, bounded payload validation, organization scope, and
generation language remain unchanged.

Tests first cover overwrite selection and full-story extraction from both current
and legacy structured improvement responses. This is a single-screen Mobile
correction with no Terra delegation because it does not overlap current worker
ownership.

## MOB-AUTH-003 and MOB-BILL-001 recovery-state slice

Purpose: finish two independent P0 recovery paths without changing entitlement or
authorization decisions. Session bootstrap must distinguish loading, 401, 403,
network/5xx, and empty-account states. Browser billing return must enter an explicit
confirming state and may show completion only after a later authoritative plan or
balance response proves that the server state changed.

Spec basis: Unified Spec authentication, organization authorization, billing, and
external-provider boundaries, plus `MOB-AUTH-003` and `MOB-BILL-001` in the Mobile
completion specification.

Affected interfaces: the Auth bootstrap UI consumes the existing safe `ApiError`
classification and retries `/api/me` plus workspace selection without deleting a
still-valid token for network/5xx failures. Billing records the pre-browser
authoritative snapshot, refreshes plan and balance with bounded exponential backoff
after foreground return, and renders confirming, completed, cancelled/unchanged, or
timed-out outcomes. Checkout and portal URLs still come only from the Backend and
open in the system browser.

Security and integrity: Mobile never grants credit or plan entitlement from a deep
link, browser return, or local timer. A 403 explains permission mismatch without
claiming authentication failure. A 401 gets only the API client's existing
single-flight refresh attempt before presenting re-login. Provider errors, tokens,
and checkout details are not logged or displayed.

Testing: add failing component/policy tests for every auth state and for billing
snapshot comparison, backoff bounds, unchanged return, timeout, and authoritative
completion. Then implement and run focused tests, Mobile typecheck, lint, and the
full Mobile suite.

Terra owns only the Auth recovery component, its integration point, and focused
tests. Sol owns only billing return policy/UI/tests, then reviews and integrates the
Terra result. The two file sets are disjoint.

## MOB-STORY-006 job credit-settlement contract

Purpose: show canceled and failed long-running jobs' actual charge/refund outcome
without inferring it from terminal status or client-side balance changes. The
authoritative source is the job-scoped credit ledger, not `credit_cost` alone.

Spec basis: Unified Spec credit transaction, refund, tenancy, and safe job response
contracts, plus `MOB-STORY-006` and `MOB-JOB-003`.

Affected layers: the generation-job repository reads aggregate consume/refund
amounts for a job only after personal ownership or active organization scope has
been established. Job service/route responses expose a bounded settlement object
with charged, refunded, net, and a stable state. Mobile response validation and
`JobStatusCard` render the settlement using localized copy.

Security and integrity: the endpoint never exposes ledger rows, descriptions,
provider IDs, or another tenant's totals. Cancellation/refund transactions remain
unchanged and idempotent. The response state is derived from persisted ledger sums;
failed or canceled status alone can never claim a refund.

Testing: write failing repository/service/route tests for no charge, charged,
refunded, partial refund, and pending refund, then implement. Add Mobile schema and
component tests before rendering the new field. Run focused Backend tests/build and
Mobile tests/typecheck/lint.

Terra owns the Backend job/repository/service/route contract and focused Backend
tests. Sol owns Mobile schema/UI/tests and final integration review. No migration is
required because `credit_ledger.job_id` already exists.

## MOB-PAGE-006 panel-editor information boundaries

Purpose: make the selected panel editor scan in the required five-domain order
without changing stored panel data or Backend payloads: situation/background,
composition/camera, characters, dialogue, and effects/notes.

The Mobile-only `PanelEditorSections` component owns the fixed section order,
localized headings, collapse controls, and the instruction that every blank need
not be filled. Each character and dialogue remains one repeated item frame; the
five sections use separators and spacing rather than nested decorative cards.
Custom expression/action fields remain conditional on the Custom choice.

Tests first prove the fixed order, instructional copy, and collapse behavior. The
existing panel payload builder and tenant-scoped API methods remain unchanged.
This compact UI composition is implemented by Sol without another Terra task
because active workers already own disjoint Auth and Backend Job files.

## MOB-STORY-004/005 presentation-proof slice

Purpose: make initial versus destructive page-skeleton generation, whole-story
application, and episode-draft improvement independently testable. Existing API
contracts and Backend context compilation remain unchanged.

`StoryGenerationControls` owns distinct initial/overwrite labels and an enqueue
acknowledgement that says processing started but never says completed. Terminal
completion remains owned by authoritative `JobStatusCard` data. The overwrite
confirmation in `StoryScreen` continues to list existing page/panel counts.

`EpisodeImprovementPanel` owns the instruction, current full-story improvement,
“improve” action, and separate “apply to draft” action. It exposes no title/purpose
apply controls. After application, `StoryScreen` keeps the result and uses the
updated current episode draft as the next improvement input. Backend repository and
writer tests already prove other chapters/episodes from the same authorized work
are compacted into context.

Component tests are written first for labels, destructive-mode distinction,
started-versus-completed copy, and improvement/apply separation. Sol implements
this Mobile-only refactor; active Terra workers retain disjoint ownership.

## MOB-JOB-003 active-resource recovery and settlement presentation

Purpose: remove screen-local job IDs as the sole source for Story, Pages, and
Characters. Each screen queries the tenant-scoped server job list for queued or
processing jobs, then accepts only a job whose safe response params contain the
currently selected episode, page, or entity ID. A newly enqueued local ID is paired
with that same resource ID so changing selections cannot display the previous
resource's job.

The active-resource query runs on mount, navigation focus, and app foreground.
`JobStatusCard` then polls the selected authoritative job and invalidates related
queries only after a terminal response. Credit display uses the required
ledger-derived `credit_settlement` DTO and never infers refund from failed or
canceled status.

Security: list/get requests retain user or organization scope and Backend
capability checks. Mobile does not inspect raw ledger data or provider errors.
Tests first cover resource matching, focus/foreground refresh, all five settlement
states, and response validation. Sol owns this cross-screen Mobile integration
after reviewing Terra's disjoint Backend settlement work.

## MOB-ENTITY-003 natural-language clothing input

Purpose: keep the broad clothing category, main color, and impression GUI while
making detailed clothing a single natural-language input instead of combining
collar, sleeve, lower-garment, shoe, and legwear selectors with a second
description. This matches the current Mobile completion contract and reduces
contradictory duplicate detail input.

Existing hidden detail keys remain in the extras object and are sent back unchanged.
A new entity writes the three broad GUI keys plus `clothing.description`, without
duplicating detail values into `outfit_detail`. No migration or Backend contract
change is needed.

Tests first prove that the UI exposes only the free-text field and that payload
merging adds only `description` while preserving legacy hidden values. Sol handles
this compact Mobile-only change; Terra audits the remaining independent
Characters/Pages gaps read-only.

## MOB-ENTITY-005 actionable generation blockers

Purpose: keep every generation prerequisite visible and add direct actions for
blockers the user can resolve. Name, unsaved entity, and unsupported type jump to
the editor; an in-progress import jumps to the import section; insufficient credit
opens Account. Permission and active-job blockers remain explanatory because the
current screen cannot safely change them.

The Characters screen owns section offsets and passes its ScrollView ref through
the shared Screen component. Jump actions scroll only within the current screen and
do not bypass Backend readiness, capability, credit, or tenant checks. Tests first
prove the blocker-to-action mapping and callback behavior; the existing policy
tests continue to prove the complete blocker set. Sol owns this small shared-Screen
and Characters integration.

## MOB-PAGE-004 explicit panel deletion before template reduction

Purpose: make layout-template reduction incapable of deleting panels implicitly.
The Backend accepts only `allow_panel_truncation:false` for compatibility and
rejects `true`; repository and service no longer expose a truncation permission.
If the selected template has fewer slots than the page has panels, layout
application returns a conflict until the user has explicitly deleted enough panels.

Mobile lists the currently excess tail panels with situation, character, and
dialogue summaries. Each row has an explicit review/delete action using the same
destructive confirmation as the panel menu. Users can first reorder any panel to
the tail through the compact panel list, then choose it for deletion. The template
action remains disabled until counts match, and its final confirmation states that
no panel content will be deleted.

Security and integrity: every deletion continues through the existing
tenant-scoped panel delete service and confirmation. Layout application remains one
transaction, but never receives client authority to truncate. Tests are changed
first to prove `true` is rejected and no deletion query is issued, plus a Mobile
component test for explicit selection and summaries. Sol owns Backend and Mobile
integration because this contract crosses the same destructive operation.

## MOB-AUTH-002 invitation availability states

Purpose: explain invitation failures precisely rather than merging expired,
revoked, accepted, and signed-in-email mismatch into one generic message. A pure
policy normalizes email case/spacing and returns one stable reason. The screen
disables acceptance for every unavailable reason and keeps “別のアカウントでログイン”
available for mismatch recovery.

The Backend remains authoritative and repeats token status, expiration, and email
matching inside its transaction. The client-side policy is guidance only and never
grants membership. Server errors remain safely mapped if state changes between
preview and acceptance.

Tests first cover pending, accepted, revoked, explicit/date-based expiry, and email
mismatch. This is a bounded Mobile-only correction, so Sol implements it while
Terra's completed Auth/Release audit is reviewed independently.

## MOB-BILL-003 server-owned platform product catalog

Purpose: remove the assumption that Apple and Google use identical product IDs.
The authenticated Mobile purchase API exposes a sanitized catalog for one requested
store, sourced from the same server-owned allowlist used for receipt verification.
It returns product ID, kind, and logical plan/package code, but no credentials,
prices, or provider configuration.

Mobile selects `apple` on iOS and `google` on Android, validates the catalog, maps
logical codes to localized labels, and only then creates the native IAP adapter.
An unavailable or invalid catalog keeps purchase controls disabled and visible as a
safe loading/error state. Receipt verification, account binding, ledger updates,
and transaction finishing remain server authoritative.

Tests first prove different Apple/Google IDs are returned and selected, unknown
stores are rejected, and Mobile definitions contain only the current platform's
IDs. This slice touches Route, Service, Domain contract, and Mobile Account/API;
Sol owns integration because it is a security-sensitive billing boundary.

## MOB-PAGE-001 authenticated image delivery and cache lifecycle

Purpose: prefer the page list's short-lived signed CDN URL without mutating its
signature, while retaining the authenticated export-image URL only as a fallback.
The Expo Image cache identity is derived from user, workspace, page, and revision;
the signed delivery URL is not itself treated as an authorization boundary.

On logout, workspace change, and completed account deletion, memory and disk image
caches are cleared so one account cannot see another account's authenticated
images. Cache-clearing failures do not restore authentication or block logout, but
both cache operations are attempted.

Tests first cover CDN preference, authenticated fallback, immutable signed URLs,
and both cache purge operations. This affects Mobile image delivery and local
state only; Backend ownership and short-lived URL signing remain authoritative.
Sol owns this cross-screen cache lifecycle while Terra works in disjoint files.

## MOB-STATE-002 shared dirty-state resolution

Purpose: make unsaved-change handling a navigation-wide contract rather than a
screen-specific two-button warning. Editors register a stable identifier, dirty
state, save callback, and discard callback in a shared provider. Tab changes,
workspace changes, logout, and background transitions all request the same
three-way resolution: save, discard, or cancel.

Save runs registered editors sequentially and navigation proceeds only if every
save succeeds. Discard resets local drafts before proceeding. Cancel leaves both
selection and drafts untouched. Authentication failure cleanup remains able to
clear local auth without attempting a save against an invalid token.

Tests first prove all three outcomes and that a failed save blocks navigation.
Sol owns the provider and integration; the concurrent optimistic-concurrency
Terra task owns Story/Character update contracts and will be reviewed before
those screens register their save callbacks.

The Story editor registers work, chapter, episode, and scene drafts as one
ordered save unit. Discard restores every field from the current server-backed
records; save updates parent records before the scene and creates a new scene
when the scene draft has no persisted identifier. Scene-only transitions use
the shared resolver because `sceneId` is local UI state rather than workspace
selection. Hierarchy selection uses the guarded `updateSelection` result and
closes only after the transition succeeds.

The Character editor registers one create-or-update unit based on whether the
current draft has a persisted entity. Creation and deletion success paths clear
or replace selection with `skipDirtyCheck` only after the server mutation has
completed, avoiding a second prompt for a draft that is already persisted or a
resource that no longer exists. User-driven entity, workspace, tab, logout, and
background transitions continue through the shared three-way resolver.

## MOB-API-001 generated shared API contract

Purpose: remove independently maintained Mobile request, response, and DTO
definitions. The canonical source lives under `packages/api-contract`; Mobile
consumes checked-in generated files so Expo does not need to resolve source outside
its project root. A deterministic generator owns the copies and a `--check` mode
fails CI when a generated file is stale or manually edited.

Scope and layers: this affects the shared contract package, a mechanical generator,
Mobile domain contract files, Backend contract fixtures, package scripts, and CI.
It does not change endpoint behavior, persistence, authorization, or response JSON.
Backend route tests parse representative actual route response bodies with the
canonical schemas. Mobile continues to parse every response boundary at runtime,
but those schemas and inferred DTO inputs no longer have an independent source.

Security: generated request contracts do not add client authority. Backend Zod
validation, authentication, organization scope, role checks, bounded inputs, and
safe response serializers remain authoritative. Contract fixtures must contain no
secrets or user production data.

Testing: first add a failing generator-drift test and Backend-fixture compatibility
test. Then move the existing Mobile schema/type/payload sources to the canonical
package, generate byte-stable Mobile copies, add `contracts:check` to local and CI
gates, and rerun Backend build plus all Mobile tests/typecheck/lint/export. Terra
owns only the canonical-file move, generator, generated copies, and drift test.
Sol owns route-fixture selection, CI integration, security review, and final
verification.

## MOB-API-005 cursor pagination and virtualized lists

Purpose: bound memory and render cost for works, entities, pages, and organization
members, invitations, usage events, and audit logs. Existing Web callers that omit
pagination parameters keep their current complete-list response. Mobile always
requests a bounded page and receives the existing collection key plus
`next_cursor`.

Backend contract: `limit` is an integer from 1 through 100 and `cursor` is a bounded
opaque base64url value. Cursors include a version, endpoint kind, immutable
tie-breaker ID, and the endpoint's sort value. Invalid or cross-endpoint cursors
return validation errors. Keyset order is:

- works: `updated_at DESC, id DESC`
- entities: `created_at DESC, id DESC`
- pages: `page_number ASC, id ASC`
- organization collections: `created_at DESC, id DESC`

Repository queries continue to apply personal ownership or active organization
membership before cursor predicates. They fetch `limit + 1`, return at most
`limit`, and derive a next cursor only from the last returned row. Usage summary is
computed independently from the complete scoped data rather than from one page.

Mobile contract: API schemas add nullable `next_cursor`; query keys include the
cursor scope; screens use `useInfiniteQuery` and flatten pages with ID de-duplication.
The list surface itself uses `FlatList`/`VirtualizedList`, with stable item
dimensions where practical and `onEndReached` loading. A selected item not present
in loaded pages is resolved through an authorized detail endpoint and never
silently cleared. The screen must not nest the large list inside the existing
vertical `ScrollView`; summary/editor content remains a drill-down from a bounded
virtualized picker.

Testing and delegation: Backend tests are written first for limit bounds, cursor
round-trip, stable tie-breaking, no duplicate boundary item, invalid cursor, and
tenant predicates. Mobile tests are written first for schema parsing, cursor query
construction, de-duplicated flattening, and end-reached loading. A Terra worker may
own the Backend pagination files and focused tests. Sol owns Mobile integration,
cross-layer contract review, and full verification.

## Mobile production observability and support correlation

Purpose: satisfy the Mobile completion specification's observability contract
without widening the data collected from a manga-production session. Native and
JavaScript crash reporting is enabled only when the validated build environment is
`production` and a production DSN is present. Development, preview, unit tests, and
local exports do not send telemetry.

Spec basis: Unified Spec sections 8 through 10 and
`docs/mobile_completion_gap_spec.md` section 6.14. This slice records release,
version, native build, Expo update, one random user-safe launch correlation ID, API
request IDs, and generation job IDs. It records the bounded operational events
`auth_failure`, `job_failure`, and `checkout_return_failure`. It does not record
tokens, email, user identifiers, story text, dialogue, image data or URLs, request
or response bodies, provider messages, S3 keys, or arbitrary caller-supplied tags.

Affected interfaces: Mobile configuration accepts a public HTTPS Sentry DSN and
fails production configuration validation when it is missing or invalid. The root
entry point initializes the SDK before rendering. `ApiError` retains the Backend
`x-request-id` header as an opaque support ID, while the API client records only a
terminal 401 authentication failure after its existing one-time refresh retry.
`JobStatusCard` records one event per failed job identity/status, and the
organization billing handoff records an unconfirmed or failed authoritative return
check. `ErrorBoundary` reports the caught exception through the same adapter.

Security: the Sentry adapter uses `sendDefaultPii:false`, disables tracing and
breadcrumbs, removes request/user/extra payloads in `beforeSend`, and reconstructs
event tags from a fixed allowlist. The adapter never accepts free-form context.
The public DSN may be bundled, but the source-map upload token remains an EAS
sensitive secret and is never stored in Git or an `EXPO_PUBLIC_*` variable.

Testing: first add failing tests for production-only activation, missing/invalid
production DSN, event redaction, release/build/update tags, API request-ID
retention, and the three bounded metric call sites. Then install the supported Expo
Sentry/Application/Constants packages, implement the adapter and integrations, and
run focused tests followed by Mobile typecheck, lint, all tests, mojibake, and both
platform exports.

Delegation: Sol owns this security-sensitive integration and final data review.
Terra independently audits release/association configuration and therefore does
not edit the observability files.

## Audit B creator-route closure

Purpose: close the two production UI gaps found by the exhaustive Backend-to-Mobile
audit without replacing the safer episode-improvement and atomic page-generation
flows. `POST /api/story/collaborate` becomes an optional episode-level StoryAI
consultation inside the existing collapsed StoryAI surface. It sends only the
current episode ID, current visible full draft, bounded instruction, selected UI
language, and empty optional context lists. Streamed text is a proposal and is
copied into the full-story draft only through a separate explicit action.

`POST /api/pages/:id/autofill-from-scenes` becomes an optional advanced Pages
action. It is available only for a selected editable draft page with a current
scene source, no active generation job, and no unresolved dirty editor. The action
uses destructive confirmation because it updates page/panel fields, sends the
current UI language and organization scope, retains the draft on failure, and
invalidates page, panel, assignment, readiness, and job-related queries only after
an authoritative success response.

Spec basis: Unified Spec sections 2, 4, 5, 6, and 8; Mobile completion API table
entries `StoryAI improve/collaborate` and `Page autofill page from scenes`; screen
sections 8.2 and 8.4; Audit B in section 14.

Security and interfaces: both routes retain Backend authentication, ownership or
active-organization membership, and edit capability enforcement. The Mobile
client adds `language` to the collaboration request contract and continues to use
the existing SSE idle timeout and abort support. Neither surface accepts raw IDs,
provider details, or client-side credit decisions. Server response schemas remain
the boundary authority.

Testing: first add failing component/API tests for English language propagation,
stream cancellation/error/draft retention, separate apply action, page-autofill
confirmation, permission/dirty/active-job disabled reasons, organization scope,
and success-only invalidation. Then implement and run the focused tests plus all
Mobile gates.

Delegation: one Terra worker owns only the Mobile creator-route closure:
`StoryScreen`, `PagesScreen`, any new dedicated components/message catalogs, the
Mobile collaboration request type/API method, and focused tests. It must not edit
Backend routes, shared generated response contracts, observability files, or the
structured-story preservation helper. Sol reviews and integrates the result.

## MOB-AUTH-001 production AASA generation

Purpose and scope: close the iOS Universal Link deployment gap without committing
a guessed Apple application identifier. The Web production build generates the
extensionless `/.well-known/apple-app-site-association` document from an explicit
Apple Developer Team ID. Local non-production builds may omit the document. This
slice does not provision Apple Developer membership, change Cognito callbacks,
deploy the Web image, or claim real-device verification.

Spec basis and layers: `mobile_completion_gap_spec.md` MOB-AUTH-001 requires a
production AASA and real link handling. MOB-REL-004 requires fail-fast production
configuration and a maintained bundle/application/link matrix. Web build tooling
owns generation; the existing static route owns delivery; the Mobile app retains
`com.lyra.mobile` and the associated domain.

Interface and security: `APPLE_DEVELOPER_TEAM_ID` is exactly ten uppercase ASCII
letters or digits. The output authorizes `TEAM_ID.com.lyra.mobile` only for
`/auth/mobile/*` and `/invitations/*`. With
`LYRA_STRICT_WEB_PRODUCTION_CONFIG=true`, missing or malformed input is a hard
build failure. A non-strict local build without the input removes a stale
generated document. The Team ID is public metadata; no signing key, App Store
credential, or Mobile secret is accepted.

Testing: add red-first tests for valid generation, missing strict input, malformed
input, and stale-output removal. Run Web builds without strict mode and with a
synthetic valid Team ID. Existing static-route tests protect JSON MIME and prevent
SPA fallback. Full acceptance still requires the actual Team ID, production
deployment, HTTPS retrieval, Apple CDN/device association, and cold/warm link E2E.

Delegation: no additional worker owns this small Web build slice. The active Terra
worker has disjoint Story/Page Mobile ownership; Sol retains production
configuration and security decisions.

## Audit B bidirectional route inventory

Purpose: turn the Backend-to-Mobile audit from a one-time manual statement into
a checked repository contract. Every mounted Backend route is either matched to
at least one Mobile API method and concrete Mobile caller, or assigned a narrow
documented exclusion such as health, provider webhook, operator admin,
store-policy Web billing, or legacy compatibility. A newly added route without a
classification makes CI fail.

Spec basis: `mobile_completion_gap_spec.md` section 14 Audit B requires every
user-facing Backend route to have a Mobile path unless explicitly excluded. The
Gap-0 definition requires zero unclassified routes and zero dead buttons. Unified
Spec architecture keeps provider, health, local asset, and admin routes outside
the consumer Mobile client.

Interfaces and security: the TypeScript AST inventory reads Hono route
definitions and their mount prefixes, normalizes parameter names, compares HTTP
method plus path with public `LyraMobileApiClient` methods, and searches Mobile
source callers outside the API client. Explicit exclusions are code-reviewed
constant entries with a category and rationale; broad wildcard exclusions are
not accepted. The generated Markdown contains no secrets or runtime data.

Testing: first require a generated Backend route inventory and `--check` success.
Then implement generation, confirm unclassified routes fail, write the current
table, and run the inventory check plus focused route tests. CI already invokes
the Mobile API inventory check, so the bidirectional table shares that gate.

Delegation: Sol owns the AST/mount/classification logic. Terra independently
audits non-route residual requirements and does not edit this script or its
generated documents.

## MOB-REL-002/004 environment-owned app-link host

Purpose: make native association configuration an explicit preview/production
build input instead of inheriting an unconditional production host from static
Expo JSON. Development uses the custom scheme only. Preview and production use
an HTTPS app-link host supplied by the checked environment profile; production
accepts only `app.lyra-editor.com`.

Inputs and security: `EXPO_PUBLIC_BUILD_ENV` selects development, preview, or
production. `EXPO_PUBLIC_APP_LINK_HOST` is a hostname, never a URL, credential,
path, or wildcard. Preview/production fail configuration evaluation when it is
missing or malformed. The dynamic config produces iOS associated domains and the
three Android auth/logout/invitation intent filters from the same validated host.

Testing: red-first app-config tests cover development removal, preview host
selection, production fixed-host enforcement, and malformed host rejection.
Expo public-config output is checked after implementation.

Delegation: a Terra worker owns only `apps/mobile/app.config.js`,
`apps/mobile/tests/appConfig.test.ts`, `apps/mobile/eas.json`, and the association
row in `docs/mobile-environment-matrix.md`. Sol reviews the evaluated config and
retains AASA/deployment ownership.

## MOB-PAGE-001 bounded thumbnail delivery

Purpose: ensure list thumbnails never download or decode full generated page
images. A dedicated authenticated Backend route loads an owned generated image,
renders a bounded WebP thumbnail through an infrastructure adapter, and returns
private cacheable bytes. The selected page alone uses the full signed CDN URL or
authenticated export fallback.

Layers and interface: Route validates auth, page UUID, organization scope, and
`view_work`; `PageThumbnailService` enforces personal ownership or active
organization access and storage-key policy; `SharpPageThumbnailRenderer`
performs bounded resize with input-pixel and output-dimension limits. Mobile
builds a revision- and session-scoped thumbnail URL/cache key and gives only that
source to `PageThumbnailPicker`.

Security: no storage key or provider error reaches the response. The service
reuses the same key ownership checks as export. The endpoint accepts no
user-controlled size/format parameter, so decompression and resize work are
bounded. Cache identity includes session, organization, page, revision, and
thumbnail variant; logout/workspace/deletion cache clearing remains authoritative.

Testing: add failing service, Sharp adapter, route, cache-key, and Mobile source
selection tests first. Verify dimensions/content type/cache headers, tenant
scope, no-generated-image behavior, and that thumbnail/full URIs differ. Run
focused Backend/Mobile tests, API inventory regeneration, build, and Mobile
typecheck.

Delegation: Sol owns the cross-layer thumbnail contract because it touches Route,
Service, Infrastructure, Mobile rendering, and the Audit B inventory. The
app-link Terra worker has a disjoint file set.

## Mobile accessibility semantic closure

Purpose: preserve the current visual UI while making selection dialogs, image
preview triggers, and form controls unambiguous to VoiceOver and TalkBack.
Selection options exposed visually as radio choices use the radio role and
selected/disabled state. Modal content is marked modal, supports accessibility
escape, has a labelled dismiss target, and restores focus through existing
modal patterns where available. Image buttons announce their action, and
`FormField` programmatically labels its input.

Spec basis: `mobile_completion_gap_spec.md` section 6.12 requires meaningful
labels, modal focus, keyboard-safe interaction, and VoiceOver/TalkBack smoke.
This slice changes semantics only; it does not redesign layout or claim real
assistive-technology acceptance.

Testing: red-first component/source contract tests cover labels, radio state,
modal semantics, accessibility escape, and existing dismissal behavior. Mobile
typecheck, lint, focused tests, and mojibake checks run after integration.

Delegation: a Terra worker owns only `FormField`, `SegmentedControl`,
`StoryHierarchySheet`, the template/choice/image-button accessibility attributes
inside `PagesScreen` and `CharactersScreen`, and focused tests. Sol does not edit
those files concurrently and reviews the resulting semantics.

## Actionable error recovery

Purpose: convert the completion specification's error matrix into explicit
recovery commands instead of message-only notices. A safe classifier maps
bounded API codes/statuses to one of Account/credits, Account/jobs,
Account/workspace, or retry. Screens render a labelled action only when the
recovery is valid for their current state; unknown/provider errors remain generic
and never expose raw details.

Spec basis: section 6.10 and the P1 checklist require an explanation plus next
action for insufficient credit, active job, timeout/network, permission, stale
input, validation, and configuration failures.

Testing and security: red-first domain tests cover the stable code/status matrix
in Japanese and English, unknown-error fail-closed behavior, and navigation/retry
actions. No raw provider message, token, URL, or arbitrary server field becomes
an action label or route.

Delegation: Sol owns the shared classifier, Notice action surface, and screen
integration. The accessibility worker has a disjoint semantic-only scope and
must not edit Notice or error policy files.

## MOB-TEST E2E-01 through E2E-18 executable contract

Purpose: replace the two informal Maestro examples with a complete, auditable
release suite whose scenario IDs exactly match section 11.4. Each scenario has
an executable flow, required deterministic staging fixture names, supported
platforms, secret environment keys, and a per-run JUnit/screenshot evidence
directory. A manifest/inventory check fails when an ID is absent, duplicated,
renamed, or points to a missing flow.

Scope and interfaces: shared login/logout helpers remain free of credentials;
the runner receives disposable Cognito users, seeded resource IDs, invitation
links, and store-test settings only through environment variables. The runner
validates the selected `ios` or `android` platform, required variables for the
chosen scenario set, installed Maestro CLI, and evidence output path before
starting flows. StoreKit sandbox and Play license-test cases stay explicit and
cannot be silently counted as ordinary staging passes.

Security and repeatability: no token, password, invitation URL, user email, or
private story content is committed. Fixture aliases are non-secret stable names;
the staging seed/reset endpoint or operator script must produce isolated users,
roles, credits, active jobs, conflicts, and deletion accounts. Failed setup,
missing variables, skipped store credentials, or missing JUnit output is a
failed acceptance run, not a pass.

Testing: red-first tests require all 18 IDs, exact spec titles/platforms,
non-secret YAML, referenced files, manifest/runner validation, and separate
store requirements. Source/unit tests can prove suite completeness; release
acceptance still requires successful runs on both physical platforms and the
evidence ledger required by Audit D.

Delegation: a Terra worker owns only `apps/mobile/.maestro/**`,
`apps/mobile/scripts/runMaestroStaging.mjs`, E2E inventory tests, the Mobile
package E2E scripts, and the E2E operations README. Sol continues the gap audit
and reviews that flows represent the named behavior rather than shallow tab
smoke.
