# Lyra Unified Specification v4

## 1. Status and authority

This document is the maintained index of Lyra's current implementation contract.
The historical v4 file was not present in the repository or its Git history when
this index was reconstructed on 2026-07-13. Where this document and executable
behavior differ, the following sources are authoritative until the discrepancy is
reviewed and this document is updated:

1. SQL migrations in `migrations/`
2. Route validation schemas and service interfaces in `src/`
3. Unit and integration tests in `tests/`
4. Browser contract tests in `apps/web/e2e/`

Applied migrations must never be edited. Contract changes require a new migration,
tests, and an update to this document.

## 2. Product boundary

Lyra is an authenticated manga-production application. A user can create works,
chapters, episodes, optional scenes, entities, page plans, panels, frames, dialogue,
and generated images. Personal work and organization work share the same production
pipeline but use separate ownership and credit scopes.

The primary user flows are:

1. Create a work, chapter, and episode.
2. Write the episode story and optionally add scene context.
3. Create and confirm character reference images.
4. Generate a page skeleton, then apply the story to editable panel fields.
5. Review entities, situation, composition, camera, background, and dialogue.
6. Generate a page image from the current saved inputs.
7. Export selected pages as images, PDF, or ZIP.

## 3. Architecture

- `src/routes`: HTTP input, authentication middleware, validation, response mapping.
- `src/services`: business workflows and transaction boundaries.
- `src/repositories`: parameterized PostgreSQL access.
- `src/domain`: types, constants, schemas, and domain errors.
- `src/infrastructure`: OpenAI, AWS, Stripe, and local adapters.
- `worker`: asynchronous generation job execution.
- `apps/web`: React browser client.

Routes must not implement provider calls or credit arithmetic directly. Services
depend on ports, and repositories own persistence details.

## 4. Authentication and authorization

Production authentication uses Cognito JWT verification. Protected routes require
authentication and resource authorization. A resource lookup must be scoped through
the requesting user's personal ownership or active organization membership; knowing
an ID is never sufficient authorization.

Account deletion stores a keyed one-way identity tombstone before anonymizing the
Cognito subject. Provisioning must reject a subject whose deletion is processing,
pending recovery, or completed, so an unexpired token cannot recreate the Lyra user.
After deletion starts, database guards reject new personal content roots while the
durable deletion workflow finishes.

Organization roles are `owner`, `admin`, `billing`, `editor`, and `viewer`.
Billing authority is separate from editing authority. Public routes are explicitly
limited to health/readiness, verified provider webhooks, static web assets, the
capability-only authentication endpoint, the fixed single-use Google linking
callback, and the organization-invitation acceptance flow where applicable.
Ordinary login identifies the existing user by the verified stable subject. It
never changes that subject solely because an email matches. New user and signup
credit grant share one transaction. Google linking has a separate, recent native
authentication proof and dedicated Google OAuth challenge; ambiguous provider
results are reconciled by reads, never by blindly repeating the link mutation.

## 5. Persistence and tenancy

PostgreSQL is the system of record. Works are either personal or associated with an
organization workspace. Organization-scoped API requests carry an organization ID,
which is validated against membership before data access.

Mobile panel append, delete, and reorder use an additive Page-scoped structure
command. The command conditionally compares the client's complete ordered Panel-ID
snapshot, shares the Episode generation-admission lock, and updates Panels, Frames,
Balloon order references, and structural layout metadata in one transaction. A Page
retains 1–8 Panels after deletion, while append may repair an empty draft Page. Count
changes select the deterministic default Frame template; reorder preserves Frame
geometry and style. Existing low-level Panel routes and persisted Panel, Frame,
Balloon, prompt, job, queue, worker, and credit contracts remain unchanged.
Balloon create, update, and automatic replacement share the Page row lock and
recheck the complete ordered Panel-ID snapshot plus order-reference bounds before
writing, so they cannot recreate a stale reference during a structure command.

Images are stored by opaque S3 keys. User input is not interpolated into storage
paths. Database responses may contain stable image metadata, while production image
delivery uses authenticated export or short-lived CloudFront signed URLs.

Episode export artifacts are asynchronous, owner-scoped records with a bounded
lifetime. Their storage keys are derived from authenticated scope, episode, and job
identifiers rather than filenames. Applying their persistence migration alone does
not enable queue dispatch, artifact creation, or download routes. Processing uses a
bounded lease token and heartbeat; only the current lease may update progress or
write a terminal state, and an expired lease may be reclaimed without allowing the
older worker to overwrite its replacement.

The export worker reads only the immutable page snapshot stored with the job. Each
source image is limited to 20 MiB, all sources together to 64 MiB, and the produced
artifact to 128 MiB. Production object reads use bounded HEAD plus ETag-conditioned
Range GET validation for MIME, size, range, and image signature. Network failures,
HTTP 429, and provider 5xx responses are retryable; invalid keys, images, or
artifacts fail with stable sanitized errors. PDF and ZIP bytes are deterministic
for the same persisted snapshot, and artifacts are private, encrypted, and written
only to the server-derived job key. These worker and storage contracts do not by
themselves enable queue polling, API routes, or downloads.

Episode export runtime wiring is independently gated by
`EPISODE_EXPORT_ENABLED`, which defaults to false. When enabled, authenticated
create/status/download routes require personal ownership or active organization
membership with export capability. Creation commits the job and outbox before a
best-effort dispatch to `SQS_QUEUE_URL_EXPORT`, or the existing generation queue
when no dedicated export queue is configured; status reads and a bounded periodic
runner recover undispatched rows. The shared queue uses the deployed
`{job_id, job_type: episode_export}` envelope, and consumers also accept the
strict versioned export-job envelope. A dedicated poller refuses a shared queue
so it cannot acknowledge generation messages. Export never consumes credits.
Completed, unexpired artifacts are delivered only through an HTTPS URL lasting no
longer than five minutes or the remaining artifact lifetime. Expiry cleanup deletes
the exact server-derived key before marking it deleted and is safe to retry.

Chapter and episode deletion is serialized with generation and episode-export
admission at the episode boundary. The authorized target, descendant episodes, and
pages are locked and blockers are rechecked in the deletion transaction. Queued or
processing generation/export work, a completed export artifact that has not been
deleted, or a persisted generated page image blocks deletion with a sanitized
conflict. Scope-external targets remain not found. This fail-closed boundary prevents
workers, retries, credits, job history, and opaque S3 objects from being orphaned by
the story foreign-key cascade. A future durable asset-deletion workflow may replace
the generated-file blocker, but a database cascade alone must never imply S3 deletion.

Native push device tokens are encrypted with authenticated encryption before
persistence and are located by a separately keyed deterministic digest. Registration
is unique per user installation, and logout removal is scoped by both user and
installation. Persistence and internal services alone do not enable registration
routes, device permission prompts, or APNs / FCM delivery.

Push notification outbox rows snapshot only completed or failed generation-job
events with no cancellation request or cancellation timestamp, and reference
same-user token registrations without copying ciphertext. A failed state never
overrides cancellation evidence for notification eligibility. Account deletion
serializes with the token registry and cancels unsent deliveries before removing
tokens. Its write guard allows a previously active job to reach a terminal state
but rejects reactivating a terminal personal job after deletion starts. Explicit
terminal settlement takes the token-registry lock before the job-row lock, then
commits the terminal state, retry-count event snapshot, outbox, and deliveries in
one transaction. Retrying a failed job invalidates its unsent failed deliveries
in the same statement. Lease-based delivery and provider dispatch must still be
verified before push delivery is enabled. The release candidate includes the
authenticated registration routes, leased delivery repository, injected APNs/FCM
providers and a bounded non-overlapping runtime maintenance loop, all gated OFF
by default. It rechecks recipient, token, deletion and job status before sending.

Account deletion is independently gated by `ACCOUNT_DELETION_ENABLED`, which
defaults to false. The authenticated API accepts no user, identity, subscription,
or storage identifier from the client. It blocks a sole active organization owner
and active personal generation/export jobs, requires explicit acknowledgement for
personal subscriptions, store billing, and assets, then checkpoints exact Stripe
subscription cancellation, exact personal S3 object deletion, personal-data
anonymization, and Cognito disable/delete. A dedicated bounded recovery runner
reclaims stale or retryable requests with a fencing token and backoff.
The claim transaction rechecks acknowledgements against subscriptions, store
billing, and assets that may have appeared after preview. Completion removes raw
subscription and object-key checkpoints while retaining only the keyed identity
tombstone required to prevent reprovisioning.
Each attempt starts at most 25 external steps and stops scheduling new external
work after 15 seconds; a normal continuation releases its claim without increasing
the failure backoff. Cognito and S3 commands also have a 30-second abort timeout.

Personal works, personal upload records, push tokens, balances, and direct
identifiers are removed. Organization works, organization billing, organization
audit/usage data, and statutory or anti-fraud billing ledgers remain attached only
to an anonymized user anchor. Store and Stripe events received after deletion
starts are deduplicated as provider records but cannot restore personal credits or
plan entitlements.

## 6. Generation jobs

Long-running page, entity, page-skeleton, and story-autofill work is represented by
`generation_jobs`. Active jobs use `queued` or `processing`; terminal jobs use
`completed`, `failed`, or `cancelled`. Active-job uniqueness prevents duplicate work
for the same resource. SQS visibility, provider timeout, retry classification,
recovery, cancellation, and credit refund must remain coordinated. Job lookup and
cancellation are scoped to personal ownership or active organization membership.
New episode/page generation jobs and failed-job retries acquire the same
transaction-scoped episode admission lock used by story deletion, then revalidate
the authorized target before entering an active state.

Generation and regeneration both create a new result from the current saved inputs.
A previous generated page image is not an implicit image reference. Confirmed entity
reference images are explicit character-consistency inputs.

Story-to-page autofill plans beat ownership across the complete episode before
expanding the existing pages. Detail compilation uses adaptive, consecutive page
packs sized by estimated structured-output cost; it must not use a fixed three-page
split. A page is never split between packs, and a pack may contain the full episode
when it fits the safe output budget.

For a complete original-page mapping without character-state opt-in, bounded
original-source requirement extraction replaces the existing beat-plan pack calls.
It preserves source-unit locators, authored quotes, ordered prerequisite/result
obligations and page completion boundaries. Global meaning ownership remains
global; extraction pack assignment does not make it a page-visible event. Detail
output allocates page-owned requirements to panels before writing panel fields.
Placement validation checks structural coverage and prerequisite order, not semantic
fidelity. Normal and repair detail calls retain the same complete requirements.
Unsupported mappings or capacity take the complete legacy path before any paid
call; a paid extraction failure does not start an additional legacy compiler call.
Requirements and placements are internal and are stripped before public saving.
Existing opt-in character-state compilation, cancellation, atomic save, prices,
HTTP contracts and the semantic soft-save policy remain unchanged.

Episode detail provider output declares a non-null entity assignment array for
every panel. An explicit empty array means no character is visible in that panel;
fallback must not repopulate it. Omitted assignments in legacy/internal suggestions
retain the existing character list. Applying an explicit empty list clears existing
assignments atomically, subject to the existing manual-state preservation/conflict
policy. Close-ups, off-panel viewpoints, and exterior cutaways may legitimately have
no visible entity.

Source omissions, dropped ongoing actions, and visible-entity contradictions are
repairable semantic findings when a safe field patch restores the input story. They
use the bounded repair passes below; they do not add a new persistence-blocking gate.

Explicitly authored dialogue, narration, and caption text are copied without
shortening or paraphrasing, with the source's unambiguous speaker and dialogue type.
Narration retains no speaker. Quoted names, titles, or labels
are not automatically dialogue. A bounded beat ledger keeps an exact line when it
fits, otherwise a source locator; it must not supply a shortened replacement quote.
The source takes precedence over a conflicting outline or ledger. Detail and audit
compare each action's prerequisite, execution, immediate result, and stated order
against actual panel fields. Missing or altered authored dialogue and action steps
use the existing field-level repair contract and semantic soft-save policy.
Compression preserves explicit decision bases, prerequisite or transition actions,
completion boundaries, negative or continuing constraints, and final viewpoint.
An authored completed action must not become stopping immediately before it.
Visible situation and composition agree with entity action metadata; poses outside
the fixed enums use the existing custom action. The auditor repairs contradictions
through the existing fields without adding a new save-blocking condition.
Chapter/episode arc summaries, page purpose, continuity, and generated ledgers are
planning context, not authored display text. A successful episode detail compiler's
omitted dialogue receives no generated fallback; existing manual-field preservation
still applies. Server fallback must not turn this context into speech, thought, or
narration. Explicitly authored display text in the full source
and provider-supplied dialogue remain subject to the existing source-fidelity audit.
The bounded coverage sidecar samples high-risk facts; it does not limit the full
episode audit to those sampled facts. Legacy single-page fallback is unchanged.

When line-start page headings in the original full story map completely,
uniquely and in increasing order to existing page numbers, segmented beat,
detail and audit inputs may also include the matching untouched contiguous
original page excerpts. Generated ledgers allocate pages; they must not restrict
the original facts to a compressed summary or reverse an explicit completion
boundary. Ambiguous or incomplete headings omit this optional local supplement
and retain the full-source input. Audit supplements must fit the existing input
budget after full source, complete dialogue and minimum panel evidence have been
reserved; otherwise the supplement is omitted. This changes provider context,
not persisted story fields, API contracts or the semantic soft-save policy.

For that complete original-page mapping, detail and audit judgments omit the
generated beat ledger, its text plan and entry/exit/handoff constraints. The
original source, page identity and frame capacity, allowed scenes/entities,
and actual compiled or repair-draft panels with their purpose/continuity remain.
Service-derived internal ownership selects this mode; user text markers do not.
The audit citation catalog contains only visible source references in this mode,
never a hidden generated beat ledger. Omitting optional local excerpts for budget
does not restore the generated beat ledger. Ambiguous mappings retain the legacy
ledger path. Opt-in validated character-state transition ledgers and their saving
workflow remain unchanged; this omission applies to generated story-beat context.

In this source-owned mode only, every provider error issue also supplies bounded
internal grounding metadata. Original-page quotes and actual draft-field quotes
are distinct. Generated page purpose, continuity, panel notes, chapter/episode
summaries and entity summaries cannot become original-source authority. Visible,
typed scene continuity and its entity-state notes, plus validated character-state transitions,
may ground their applicable continuity issues. Deterministic exceptions must match
an actual service finding's code and page scope. Optional excerpt omission does
not authorize quoting hidden source: authority quotes must remain in the displayed
full source or other typed visible authority. This metadata is discarded before
the public audit result or persistence; omitted/false source ownership retains the
legacy response schema and retry behavior.

For complete source ownership, an optional provider-only source-unit review
contract enumerates lossless spans of typed original global preface and page
source. Generated plans, purposes, notes, summaries and scene/state context never
produce these units. Offsets bind each span to its exact visible source string;
sentence boundaries organize review and do not claim to isolate every fact. All
units and their displayed catalog are produced together. Enable the entire list
only when it has at most 256 units, its additional display fits 8,000 characters,
and full source, complete dialogue and minimum panel evidence remain reserved.
Empty, ambiguous or oversized input retains the existing contract as a whole;
partial unit review is never advertised as complete and does not reject long
episodes.

Native source-unit review additionally binds integer evidence IDs to actual
same-page displayed panel fields, including short fields that cannot supply a
four-character quote. Generated purpose and continuity never supply evidence.
Reserve the complete field-ID display before optional visual excerpts, then bind
IDs to the final displayed text. At most 1,024 fields, 40,000 field-display
characters and a 16,000-character worst-case comparison response are permitted.
Exceeding any bound falls back as a whole; no partial list is advertised.

With this native catalog, source_unit_review has one comparison per unit:
verdict (supported, constraint, context, missing or conflict), up to four positive
field IDs, up to two counter-evidence IDs, and an existing grounded error index or
null. Supported requires actual positive panel evidence; conflict requires
counter-evidence; missing/conflict link a source-grounded error scoped to that
unit. Context/constraint classify headings, directions or restrictions rather
than requiring every unit to depict an action. These classifications are model
judgments and can still be wrong; they are never accepted as semantic proof.
Internally supplied legacy catalogs without a field catalog retain their existing
integer/null vector. This neither requires all issues to be linked nor makes a
repair mandatory. Patchless findings, validated-state ambiguity and second-audit
semantic soft-save retain their existing handling. Comparison results stay frozen
during quote-only correction and are discarded before public output/persistence.
Every authored clause must be compared for functional meaning, same-page
completion, explicit conditions, specified emotion and viewpoint, including
conflicts with negative draft notes. Actual semantic review remains a separate
acceptance gate. No additional call, model, token budget or save gate is added.

An invalidly grounded body uses the existing remaining structured-response retry
for a full audit. Only a valid grounded body and repair scope with an invalid
coverage sidecar may freeze that body and request a strict coverage-only retry.
Recombination revalidates grounding, scope and coverage, including missing-fact
issue/repair links. The coverage-only response cannot change acceptance, issues,
repairs or grounding. Cancellation checkpoints precede either retry.
Coverage-only retries use a dedicated system instruction and at most 12,000
characters of frozen issue-code/page/panel/visible-field linkage metadata, without
echoing the prior audit's prose, evidence quotes or patch values. If this bounded
metadata cannot fit, the existing remaining attempt is a full audit retry.
When the complete coverage structure, page/ref scope, status and repair links
are valid and every retained citation error is a known-reference exact-quote
mismatch, the same remaining request may correct only those quote slots. This
requires no omitted diagnostics and at most the existing eight diagnostics. A
strict fixed-key object returns only the corresponding 4-40 character quotes;
page/ref/status/check counts, links and the frozen audit body stay server-owned.
Source-quote slots remain bound to the same visible, typed source authority. The
joined result revalidates every grounding and coverage check against the same
displayed catalog. Missing/extra slots, nonexact or hidden-tail quotes fail;
unknown refs, structural/link errors and omitted diagnostics retain the existing
retry branch. This does not add a request or relax model, token, cancellation,
transport, semantic-review or persistence contracts. A finite content schema does
not itself prove provider completion within the token budget.
Before freezing, repairs must cover their error pages and have valid, unique field
targets under the existing repair contract. Each audit
pass still has at most two logical structured requests, the existing 20k output
limit and unchanged transport retries; this is not a two-HTTP-attempt guarantee.
The source-owned provider acceptance condition is stronger, while semantic
soft-save, the second audit pass and atomic persistence remain unchanged. Exact
quotation establishes existence, not whether a proposed repair follows from the
source, so actual saved-output acceptance remains a separate verification gate.
Repair completeness is a freeze-eligibility condition only. A valid grounded
audit may contain patchless semantic issues; validated-state ambiguity and the
second audit's mixed patchable/residual findings retain their existing Service
handling. When coverage needs retry but repair completeness is insufficient for
freezing, the remaining request is a full audit.

The OpenAI episode auditor returns a bounded source-coverage sidecar in the same
structured response: one entry per page, at most two high-risk facts per entry,
at most two actual panel-field citations per fact, and exact quotes of 4–40
characters. Source and output references are checked against the current planning
snapshot. Output citations use the whitespace-normalized actual field prefixes
shown in the audit prompt; synthetic truncation markers are not citable evidence.
The prompt and citation catalog are built together, while original story text and
persisted dialogue remain unchanged. Literal ellipses in untruncated data remain
part of that data.
Each displayed visual field and complete dialogue line is labeled with its direct
panel-field reference. Quoted visual literals exclude synthetic display markers;
fields shorter than four characters remain actual content but are not citable.
Citation retry feedback contains bounded positions and known references only
(at most eight diagnostics and 4,000 characters), with omitted counts. It does not
echo quotation text, unknown reference values, or the previous coverage response.
Page purpose, continuity, and ledger metadata are not visual evidence.
A reported missing fact must link to an error and an actual panel-field repair on
the same page. Citation validity proves that quoted text exists, not semantic
equivalence or exhaustive source coverage. Legacy/internal compiler ports may omit
the sidecar. Provider retries, output-token limits, atomic saving, and the semantic
soft-save policy remain unchanged; this does not add another provider call.

The combined draft is reviewed for cross-page repetition, dialogue placement,
chronology, page handoffs, entity assignment, and editable visual fields before any
page or panel content is persisted. Review repairs are field-level patches: page and
panel identity, order, and panel count are immutable. Unknown identifiers or invalid
patch targets are rejected. Semantic review uses at most two audit passes and applies
each pass's validated field-level repairs once; it must not recursively audit or
repair. The first audit is required. If the second audit remains unavailable after
its structured-output retry, the already repaired draft proceeds to the deterministic
gate instead of being discarded. After bounded repair, schema, identifier, structure,
and deterministic cross-page duplicate errors block persistence. Residual semantic-
only findings are retained as safe telemetry and do not discard otherwise usable
content. The plan uses each existing page's frame count as its story capacity and
carries scene character-state notes such as costume and injury through the global
continuity brief.

Episode autofill supports cooperative cancellation while queued or before the
atomic persistence gate. Once `commit_started_at` is set, cancellation is rejected
and the complete generated plan is written in one PostgreSQL transaction. The
transaction locks the authorized episode planning graph, rechecks the input
fingerprint, and applies page, panel, and entity assignment changes together so a
concurrent edit is not silently overwritten and a partial plan cannot be exposed.

Cancellation request metadata is paired, cancellation and commit start are mutually
exclusive, and a cancelled job carries ordered request, cancellation, and completion
timestamps. New writes are protected before legacy rows are validated. Production
invariants must report zero legacy violations before a later migration validates the
constraints or cancellation is generalized to additional job types.

Generation-job history hiding is a per-user display preference. It never deletes a
job, changes its status, cancels work, or mutates credits. Any future history write
must first authorize the job through personal ownership or active organization
membership.

Confirmed state-reference copies use a durable exact-key intent before storage
mutation and serialize confirmation with the user's account-deletion row gate.
Every new copy intent includes a unique attempt ID and an explicit unresolved,
succeeded, or not-dispatched state. An unresolved, legacy, malformed, or duplicate
attempt history blocks further copy admission for that job and personal deletion finalization,
even after database connection loss. Only a complete successful single-attempt
storage response or proof that this invocation never dispatched its own attempt
can settle that attempt; abort, elapsed time, object existence and another retry
are not settlement evidence. Failure to persist settlement remains fail-closed.
The intent and historical page-input references remain protected from image/job
pruning until an explicit cleanup or personal account-deletion workflow handles
them. Personal cleanup verifies storage-owner and entity scope and excludes
organization assets. Retaining these job records increases retention; expiry alone
must not erase the only deletion checkpoint.

Legacy note-only state assignments resolving to the same base reference image
share one billable image, prompt label, snapshot reference, and attachment.
Distinct confirmed variant images remain separate. Authorization and freshness
checks apply to every original assignment before this canonicalization.

## 7. Credits and billing

Text AI operations are free. Entity preview/import analysis and page generation use
the configured credit costs. Credits are deducted transactionally with row locking
and a ledger record. Failed chargeable jobs are refunded idempotently.

Personal credits and organization shared credits are separate. The active workspace
determines which balance is displayed and charged. Stripe webhook events, after
signature verification, are the authority for subscription and purchased-credit
grants. Browser return URLs never grant credits.

Mobile store billing remains disabled unless its server verifier, product allowlist,
credentials, and explicit feature flag are configured. When enabled, verified Apple
or Google evidence is authoritative and may affect only personal credits. Raw
StoreKit JWS values and Google Play purchase tokens are never persisted; keyed
digests identify purchases, provider events, and credit-ledger mutations behind
independent uniqueness barriers. Applying the persistence migration alone does not
enable a purchase route or grant credits.

## 8. Input and output safety

- Request bodies use bounded Zod schemas.
- SQL uses parameter binding.
- Uploaded images are restricted by MIME type and size.
- Direct image uploads use short-lived, single-use records bound to the user,
  optional organization and entity, MIME type, size, and a server-generated
  temporary storage key. Only a token hash is persisted.
- LLM structured output is schema-validated and quality-gated before persistence.
- Authenticated AI-generated content reports use a fixed kind and reason vocabulary,
  accept only an optional opaque UUID for correlation, and emit a privacy-minimized
  operational receipt without attaching prompts, generated content, images, email,
  tokens, or provider responses.
- Authenticated organization safety reports require active `view_work` membership,
  accept only the organization UUID plus a fixed target kind and reason, and emit a
  privacy-minimized receipt without accepting workspace content, target-user IDs,
  email, prompts, URLs, or other tenant data.
- Raw provider errors, credentials, connection strings, and stack traces are not
  returned to end users.
- External calls have bounded timeouts and retry only retryable failures.

## 9. Availability contract

`GET /healthz` is process liveness and must not depend on PostgreSQL or providers.
`GET /readyz` is service readiness and checks PostgreSQL connectivity. A readiness
failure returns a generic HTTP 503 response without infrastructure details.

The API must remain responsive while generation work is queued. Workers can scale
independently of the API. Queue depth, oldest message age, job duration, failure
rate, credit refunds, database capacity, and provider errors are operational signals.
Episode export supports a separate queue and worker process with its own
visibility timeout, outbox recovery and artifact cleanup. The current production
shared generation queue is also supported for compatibility; shared polling uses
the generation visibility policy and dispatches by the verified job type.

## 10. Verification gate

Every release must pass:

- Vitest and Bun test entrypoints
- PostgreSQL migration and deployment-invariant checks
- read-only release compatibility check for the intended backend-only or new-mobile profile
- backend TypeScript build
- frontend lint and production build
- Playwright auth and authenticated-console smoke tests

Production deployment additionally requires runtime configuration validation,
migrations as a one-off task, healthy API readiness, worker rollout health, queue
inspection, and post-deploy log review.

## 11. Release compatibility additions (2026-10-01)

Server generation quotes pin actor/workspace, operation, current resource revision,
references, render style, model, quality, tariff and price. Acceptance atomically
creates the job, debit/ledger, target transition and dispatch intent. Receipts
reconcile uncertain responses without a new charge. Existing unquoted clients and
jobs keep their supported contracts; new Mobile paid flows require quotes.
GENERATION_QUOTES_ENABLED defaults to false until runtime acceptance is complete.

Unversioned generation-job history and detail preserve the four production Mobile
job types. Clients request `job_contract=v2` to receive `entity_import_analysis`;
history applies that type selection before pagination, and an unversioned import
detail/cancel request is not found before mutation. Active-resource and native push
eligibility remain limited to their existing job types. Safe nested page-image job
metadata accepts the bounded public provenance fields while omitting image locations.

Unversioned export status preserves the production Mobile flat DTO, including
episode, format, filename, progress and cancellation metadata. A completed artifact's
optional `download_url` is obtained through the existing scoped, audience-checked,
expiry-bounded download service. `export_contract=v2` selects nested progress/error
and `download_ready`; new Mobile clients explicitly request it. Blank filenames use
the existing safe default. Contract negotiation never changes ownership or image
delivery authorization.

Organization member, invitation, usage and audit-log lists preserve production
`limit`/`cursor` pagination with strict cursor validation and authorization on every
page. Usage totals cover the complete month independently of page size; legacy
unpaged response bounds do not truncate those totals. See
`docs/organization-pagination-compatibility-design-2026-10-02.md`.

Output provenance is adapter-sourced. Missing historical metadata has a separate
legacy policy from an unknown model value. Known Web-only output is blocked from
all common/Mobile display, saved-image and export paths. Dedicated Web delivery
requires a verified Cognito app-client allowlist, never a platform header. A
client ID shared with Mobile must never be allowlisted: enablement requires a
dedicated Web client and rejection tests with both old and new Mobile tokens. Hy4
image generation remains unavailable until its actual provider contract is known;
there is no substitution with an unrelated image model.

Standard OpenAI image generation must reject an assigned confirmed primary/state
reference with Web-only, unknown or conflicting provider provenance before job
admission or debit, and recheck before an image provider call. Flexible-generation
requests and references must never fall back to an OpenAI image model. An assigned character's
active primary remains subject to this check even when a named state provides
the rendered reference; a compatible state cannot bypass a Web-only primary. A new
preview does not replace the confirmed reference until confirmation; confirming a
standard compatible reference restores standard page eligibility without deleting
historical images. Unassigned characters and inactive historical references do not
block unrelated pages. The same input boundary applies to explicit entity-preview
sources and state-preview bases. Web identifies both providers and Web-only output;
Mobile retains standard generation and displays the Web-only notice.

The production source lineage differs from main. The release preserves its legacy
HTTP contracts and scheduled-billing, push, export, page planning and editorial
behavior while retaining candidate deletion/refund/ownership protections. Applied
001–041 migrations are immutable. The existing 046 bridge requires a full
write freeze, so it is not an eligible first rollout under the uninterrupted
operation requirement. The first legacy compatibility phase must retain the
physical schema, old settlement and terminal-push ownership, existing billing
and deletion workflows, old export relation and old-worker job contracts.
An explicit, read-only validated persistence profile must be injected before
HTTP admission, queue consumption or recovery. Candidate startup attests the
required canonical migration, relation, column and definition signatures in a
bounded read-only transaction before starting writers. Automatic migration is
limited to a verified empty schema or known canonical lineage; namespace sequence,
enum, domain or application-function leftovers are not an empty schema. These
required signatures do not attest every possible hybrid schema or trigger-function
body and do not establish legacy production readiness. Unknown or hybrid schemas refuse
candidate startup while the old runtime remains available. Feature flags alone
are not proof that existing queries avoid absent columns. New capabilities may
remain gated; existing published capabilities must continue. Mixed old/new
writers and rollback with candidate-created records must pass on a representative
copy before production readiness. The 046 rename is a separate later proposal;
its old-image rollback restriction must not be applied to this first phase.

The release Mobile navigation has four primary tabs and nested creation steps.
All editing capabilities and stored values remain available; simple display
changes must not erase aliases, scene entities or unsaved fields. New state UI,
Google, quote and Web-only-delivery capabilities remain gated until their own
external and device checks pass. Detailed requirements, compatibility evidence and
remaining gates are recorded in the documents below, not inferred from test totals.

The optional state-copy v2 protocol uses a durable non-cascading journal,
conditional image writes, retained ordinary markers and exact-version erasure.
Admission defaults OFF; recovery, read authorization and retention remain active
for existing v2 attempts when configured. Legacy unknown outcomes are never
converted to completed evidence. Personal finalization requires verified fencing
and original source cleanup before journal scrubbing; organization assets remain
under organization authorization. Actual storage policy/retention acceptance is
required before enablement. See the local design and audit follow-up below.

New unsaved person forms show the six editable basic defaults selected by the
frontend design; existing blanks, imported suggestions, aliases and hidden fields
are not backfilled. Unresolved existing selections remain read-only until their
snapshot loads. Editor errors retain operation and local draft context. Successful
mutation receipts survive failed refreshes, while ambiguous state confirmations
retain an explicit unknown outcome through state navigation and reconciliation.
Read recovery never silently repeats a paid mutation. Targeted rendered-style
contrast is tested locally; native layout and accessibility acceptance remain open.

### Draft reference image binding (2026-10-05)

An entity image import without an existing entity returns an opaque, signed
entity-draft candidate token (v3). It binds user, organization (including personal
null scope), requested entity type, temporary image key and expiry. Existing
entity imports retain the entity-bound v1 token and continue accepting a locally
edited entity type before that entity is saved. Ownership and organization scope
are verified before paid import analysis; type editing grants no extra permission.

POST /api/entities/:id/reference-candidate/bind accepts only candidate_token and
returns only a bound candidate_token. It requires edit_work permission and target
ownership, and checks the draft token's user, organization, entity type, source-key
policy and expiry. Binding issues a v1 token for that target with the original
expiry; it neither renews the temporary image nor invokes provider, credits,
storage writes or DB mutation. Rebinding within the same scope and expiry is
idempotent and is not a single-use claim. Existing v1/base and v2/state validation
remain unchanged. Quoted import results retain the same opaque response fields.
No persistence schema changes or migration are required for this token addition.

Browser draft imports are kept in their original workspace/work/type until the
created entity is bound. Binding failure keeps the successful entity creation and
the candidate for retry; recovery does not analyze or charge for the image again.
The installed Mobile path does not adopt an unbound draft candidate after creating
an entity, so its prior restriction remains; existing entity imports remain v1.

Browser navigation and same-resource refresh preserve unsaved chapter, episode,
entity, scene, page-settings, panel and frame input. Cancellation never saves or
changes selection. Background loading and errors are not authoritative empty
lists. Remote removal retains local edits and requires an explicit selection;
revoked workspace access exposes local recovery for copying without restoring
server permissions. Save responses preserve later typing and omitted dirty fields,
and reject older known revisions. Panel assignment failure after metadata success
rebases only the successful data and prevents generation. Frame edits must be
saved before page generation; layout replacement and deletion preserve drafts
until a successful, explicitly requested operation.
Frame records have no server revision field in the current API. The browser
checks the observed baseline at submission and refetches without adopting a late
response if that baseline changes. This client check does not add server-side
optimistic locking. An empty initial selection is not a disappeared record and
never replaces the current action's success or error notice. A draft candidate
is retained with its original type when that type changes during import; changing
back reuses the candidate without another analysis.

## 12. Related documents

- `docs/Lyra_StoryAI_SubSpec.md`
- `docs/runtime-contract-readiness-design.md`
- `README.md`
- `migrations/`

- `docs/release-readiness-2026-10-01.md`
- `docs/release-feature-traceability-2026-10-01.md`
- `docs/release-ui-traceability-2026-10-01.md`
- `docs/generation-quotes-atomic-admission-design-2026-10-01.md`
- `docs/google-identity-link-readiness-2026-10-01.md`
- `docs/production-lineage-bridge-design-2026-10-01.md`
- `docs/production-billing-compatibility-2026-10-01.md`
- `docs/image-provenance-delivery-design-2026-10-01.md`
- `docs/editorial-layout-compatibility-2026-10-01.md`

- `docs/state-copy-fenced-recovery-local-design-2026-10-02.md`
- `docs/account-deletion-fenced-references-local-design-2026-10-02.md`
- `docs/release-readiness-audit-2026-10-02.md`

- `docs/mobile-new-character-defaults-design-2026-10-01.md`
- `docs/mobile-operation-error-context-design-2026-10-01.md`
- `docs/mobile-state-operation-outcomes-design-2026-10-01.md`

### Local release compatibility preflight (2026-10-02)

Run `bun run release:check --profile backend-only` for staged backend work,
or `bun run release:check --profile new-mobile` before distributing the new
Mobile client. The compiled artifact uses `release:check:prod`. The checker
requires exact migration 001–047 history and evaluates existing data invariants
and v2 journal presence in one bounded repeatable-read, read-only transaction.
Malformed or missing database results fail closed. It never applies a migration
or changes feature flags. Historical 026 and 039/041 preflights remain specific
to their older schema boundaries and must not be run against schema 047.

Backend-only permits quotes OFF; new-mobile requires quotes and the existing
paid page/entity/import operations, direct uploads, durable queue, GPT Image 2
and image storage, with local image fallback disabled. Optional state preview
may remain OFF. Any v2 journal requires complete recovery configuration even
with copy admission OFF. Enabling Web image delivery requires an explicit
inventory of every old/new Mobile Cognito client via repeated
`--mobile-client-id` arguments and rejects overlap with the Web allowlist.
Old/new Mobile may intentionally share one client; an empty Web allowlist needs
no Mobile inventory because dedicated Web image delivery remains disabled.

A passing check proves local declared compatibility only. Storage attestation,
client inventory and runtime configuration are not proof of actual remote
IAM/S3/Cognito/provider behavior, queue drain, migration lock duration, old
installed-client behavior or signed-device acceptance. Those remain separate
release gates.


### Isolated staging runtime

An explicit APP_ENV=staging uses NODE_ENV=production and the same database SSL,
authentication, CORS, storage, origin, timeout and generation infrastructure guards.
Staging must declare isolation, the actual runtime secret source and a current
production resource deny inventory; deployment binds LYRA_APP_SECRET_ID and
STAGING_SECRET_SOURCE_ID to the same dedicated secret and IAM denies production
resources. This metadata is not a replacement for IAM isolation. Stripe configuration
is either wholly absent (existing fail-closed adapter) or complete test mode only.
Only staging may omit the OpenAI key when all five generation gates are explicitly
false in the input environment and generation quotes remain disabled. Provider
operations then fail closed; production still requires a real provider key.
