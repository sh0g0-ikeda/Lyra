# Release audit follow-up and dormant state-copy recovery

## Release judgment

This is a local improvement candidate, not a production-release approval. The
preserved CI-green baseline is `6c0c9681d8354ab2ed7cfbef51edf6990370930e`.
Passing isolated tests does not establish production data compatibility, provider
configuration, remote erasure guarantees or native-device acceptance.

## Compatibility fixes after the green baseline

The independent audit compared actual production Mobile source schemas with the
candidate HTTP responses, rather than parsing every response with only the new
client's schema. It found and repaired:

- New import-analysis jobs breaking old clients' four-type job enum. Unversioned
  history/detail/cancel keep the old contract; updated clients request v2. Type
  filtering happens before database pagination
- Flat legacy export status fields and completed download URLs missing from the
  replacement DTO. Unversioned status is restored through the existing scoped
  signing service; updated clients request v2. Blank names retain defaulting
- Organization members/invitations/usage/audit pagination dropped, with monthly
  totals based on only the most recent 200 records. Stable authorized pagination
  and complete-month aggregates are restored
- A historical Google refund reversing a later renewal's allowance; and a new
  replacement token's RTDN being ignored before linked-token ownership lookup
- The limited persisted nested page-provenance shape conflicting with the strict
  response schema. Normal flat worker results and private image redaction remain
  covered

The exact local compatibility checkpoint is
`58e6b1c2b48ece5d2463b2da48d666f6d1314b90`. It passes 2,587 tests in 345 files on
PostgreSQL 18/Vitest and PostgreSQL 16/Bun 1.3.14, plus 927 Mobile tests, typecheck,
lint, generated contracts, backend build, Web lint/build and 150-route inventory.
Those figures apply to that checkpoint, not to unfinished later changes.

## Dormant state-copy v2

New migration 047 adds a non-cascading journal. Admission is OFF by default.
Conditional image writes, retained ordinary markers, exact-version purge and
immutable receipts provide a locally testable recovery protocol. Source admission,
reader/quote authorization, account deletion, image/job retention and runtime
configuration use that journal. Existing legacy unknown outcomes remain blocked.

Independent local review additionally required recovery before stale preview
validation, authorized organization-editor recovery after the original actor
leaves, preservation of orphaned original source inventory, and rejection of v2
keys by all ordinary deletion adapters. Each confirmed finding has a reproducible
local regression; final aggregate results belong in the exact revision manifest.

The storage contract assumes policy-enforced conditional writers, exclusive
recovery authority, retained ordinary markers, controlled versioning history and
no unmanaged replication/restore. Configuration attestation records an operator's
assertion; it neither inspects nor enforces those AWS settings.

## Preserved state-recovery checkpoint verification

The combined candidate passes 2,769 tests in 356 files in each of these runs:

- Vitest with PostgreSQL 18.3
- Vitest with PostgreSQL 16.14
- Native Bun 1.3.14 (production Dockerfile version) with PostgreSQL 16.14
- Native Bun 1.4.2 (last observed CI version) with PostgreSQL 18.3

A fresh PostgreSQL 18.3 database applies migrations 001–047, a second application
makes no changes, and all 71 deployment invariants pass. The production 041
lineage bridge, historical 039/041 preflight, concurrency, authorization and
corruption fixtures are included in the test totals. Mobile passes 927 tests in
183 files, typecheck, lint and contract generation. Backend TypeScript, Web
lint/build and the 150-route API inventory pass. Android and iOS JavaScript/assets
export offline with telemetry and upload disabled; these are not signed packages
or store submissions. The independent final review re-ran 46 public-recovery and
journal tests after rechecking all reproduced findings.

These tests use disposable databases and in-process storage/provider doubles.
No actual AWS or paid-provider operation was performed. New-revision GitHub CI
and browser smoke remain unrun: the source-publication action was blocked. The
last successful remote CI/browser run belongs only to preserved 6c0c968. The exact
new local source commit and artifact hashes are recorded in the delivered manifest.

## Deployment and rollback boundaries

Apply 047 only through the reviewed migration process. Its new empty table and
indexes do not rewrite existing application rows; real lock/load acceptance is
still required. The earlier production-lineage bridge retains its full write
freeze, queue drain and forward-only rollback restrictions.

Before any v2 admission, an intake-disabled image can remain on the compatibility
baseline only if there are no v2 journal entries and all earlier release gates
pass. After the first v2 attempt, a rollback image must retain v2 journal-aware
reads, pruning exclusions, deletion fencing and recovery while admission is OFF.
Returning to a pre-v2 binary is not an accepted rollback. Disabling admission must
not remove recovery role configuration. Never delete journal rows or markers to
make a release check pass.

## Remaining acceptance gates and minimum decisions

1. Production database: obtain an approved read-only path, inspect actual full
   filename migration history and sizes, rehearse the production-lineage bridge
   on a protected representative copy, and measure locks with a bounded budget.
   Existing-data, identity-subject and mixed old-client/worker acceptance are
   independent of empty-database migration tests
2. State-copy storage: approve the role/policy changes and marker-retention
   policy described in `review/state-copy-recovery/実行前レビュー.md`, inspect
   bucket versioning/lifecycle/replication/restore and KMS conditions, then run a
   bounded real-S3 acceptance plan. No such infrastructure change or live S3
   mutation is included here. Legacy unknown attempts require individual proof
3. Google sign-in/link: verify the actual IdP, app clients, redirect/logout URLs,
   scopes and linking trigger. Select the iOS sign-in policy where needed and
   exercise cancelled/replayed callbacks and account recovery
4. Web-only images: the current source packages a shared Web/Mobile Cognito
   client ID. Never allowlist that shared ID. A dedicated Web client and rejection
   checks with both old/new Mobile tokens are mandatory before enabling delivery
5. Quotes and image providers: new Mobile paid flows require server quotes.
   Leaving quotes OFF is not a complete paid-flow release. Verify configured
   tariffs, refund/timeout behavior and real output quality with an explicit
   provider spending budget. Hy4 stays unavailable until its official image API,
   output contract and price are established; no substitute is inferred
6. Artifacts and device acceptance: build the actual target container architecture,
   validate the signed-distribution configuration without submitting it, and
   exercise old installed clients plus native editing, safe areas, interruption,
   accessibility and purchase/restore flows using authorized test accounts.
   Browser smoke and local JavaScript exports are narrower evidence

No item above authorizes merging, deployment, production migrations, store/OTA
submission, a paid build, purchasing, persistent access changes or paid generation.

## Adopted frontend requirements follow-up

The frontend design at `01c1bf6dc1057f1731770d4118e7508eee884433` selects new-form
defaults, operation-specific failure/outcome context and readable dark controls.
A bounded follow-up from `138d62c` closes the identified local omissions:

- Six editable existing-domain defaults apply only to fresh person drafts. Saved
  blank/null values, hidden fields, aliases and imported suggestions are preserved.
  Unresolved existing selections cannot accept edits that a delayed read discards
- Core editor, hierarchy and job-action errors retain operation/target and proven
  local draft facts. Confirmed writes are separated from failed subsequent reads;
  refresh never silently repeats a mutation or infers credit settlement
- Named-state confirmations preserve valid receipts. Unknown outcomes keep the
  same original request across state selection. Explicit reconciliation renews
  the original completed job's token; generic conflicts do not prove settlement.
  A successful read of changed saved values permits an explicit return to editing
  while retaining the uncertainty notice
- Actual rendered-style foreground/background/ancestor-opacity combinations cover
  changed active help text, placeholders, inputs, notices and selected panels.
  Targeted text ratios exceed 4.5:1 and essential input boundaries exceed 3:1.
  This does not certify every screen or actual native accessibility

The combined Mobile suite passes **1,011 tests in 186 files**, typecheck, full lint,
generated contracts and mojibake checks. Backend TypeScript, Web lint/build and the
150-route inventory pass again. An independent bounded review found no remaining
local blocker in these repaired flows and checked the final file hashes. The
source SHA and offline-export results are recorded in the delivered manifest.

The full backend suite also passes again on disposable PostgreSQL 18.3:
2,769 tests in 356 files. The new UI changes do not modify backend, Web, package locks, migrations or shared
API schemas from `138d62c`. Clothing search and page-number selection implement
documented alternatives. Unsupported detailed example presets, frequency ranking
and a full PC state editor are not added by inference. Branded authentication
domain/mail are separately retained infrastructure proposals, not newly imposed
Google release prerequisites. Real layouts, devices, provider images and external
configuration remain unverified.
