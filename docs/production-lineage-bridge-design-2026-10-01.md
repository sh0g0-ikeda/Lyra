# Production lineage bridge (local rehearsal only)

Source baseline: production code 2debe8c3c22633ed077e7b189ddcfa8b209a00dc.
The frozen SQL under tests/fixtures/production-lineage-2debe comes verbatim from
that commit. No live production database has been contacted.

## Current release constraint (2026-10-04)

The user requires the published application to keep its existing operations
available throughout an additive release. The write-freeze transition below is a
historical, local-only rehearsal and is **not an accepted deployment plan for this
release**. Do not invoke its quiescence option or schedule a maintenance outage to
make the release gate pass.

First establish the production lineage on an authorized isolated representative
copy. If no bridge is required, rehearse bounded additive migrations and old/new
API and worker coexistence on that lineage. If this bridge is required, a separate
compatibility image and additive transition must be designed and tested before
cutover. New-backend/old-client contract tests and fresh-schema tests alone do not
prove coexistence. Existing works, image references, ownership, balances, ledger,
refunds, cancellation and provider callbacks must remain correct. No such
representative-copy or mixed-writer acceptance has yet passed.

The current repositories do not select a legacy physical-schema adapter. Page
story metadata uses JSON; export and deletion access use `episode_export_jobs`.
The old physical story columns can diverge from JSON as soon as old writers
resume after the one-time copy. The old late-consume/refund and push triggers also
cannot be combined blindly with new explicit settlement and notification logic.
Deploying a compatibility image first does not make the existing 046 command
nonblocking: its quiescence check and ACCESS EXCLUSIVE locks still stop that
image's writers. Canonical production naming alone does not exempt it from the
current bridge-required gate. An accepted transition must separately preserve old
writer admission, one settlement owner, job routing and deletion evidence, with
old/new execution-code fixtures and representative-copy checks. The frozen SQL
fixtures used by the historical bridge tests prove schema behavior only.

## Ordered transition

1. Read-only aggregate preflight identifies the candidate, canonical production,
   known legacy-mobile aliases, or an unsupported hybrid. A filename alone never
   proves compatibility: the required columns, constraints, and data are checked.
2. Stop old generation/export/account-deletion writers and workers. Existing
   active jobs/leases block the bridge. The one-off migration command requires an
   explicit quiescence acknowledgement; ordinary auto-migration cannot opt in.
3. Under the existing migration lock and a transaction, recheck the profile and
   blockers while holding write-blocking table locks. Execute the new 046 prepass.
   No historical 001–041 file is edited or overwritten in migration history.
4. Rename export_jobs/export_job_outbox in place, preserving row IDs, FKs and
   data. Add push organization scope from the existing generation job. Remove
   superseded old push/late-consume triggers before new explicit settlement
   wiring. Preserve production billing columns and purchase/credit history.
5. Preserve physical page story metadata columns, and copy their authoritative
   values into layout_config, including null/empty clears. Newly missing columns
   are initialized from the pre-existing JSON only after structural validation.
6. Install the candidate's stricter checks only after all affected legacy rows
   pass read-only checks. Never guess cancellation actors, rewrite opaque tokens,
   re-encrypt devices, alter subscriptions, or adjust credits.
7. Preserve original deletion evidence and reject any unresolved legacy pending
   request, lifecycle-scheduled asset inventory, or completed receipt that does
   not meet the final scrub contract. Deriving a keyed identity is not proof of
   completion and does not authorize erasing its original value. Missing secrets,
   invalid identities and ambiguous identities also block the bridge. No new
   credential, acknowledgement, cleanup or completion evidence is synthesized.
8. Preserve every original migration filename. Add verified legacy alias receipts
   without deleting the old identities, and run genuinely pending candidate
   migrations in their normal order after the successful 046 compatibility step.
   Failed prepass transactions roll back all schema/data/history changes.

## Rollback boundary

The old 2debe image addresses the old export table names. It is not a safe rollback
image with exports enabled after an in-place rename. This is a forward-only
schema change: rollback must use a compatibility-aware image with new admission
flags off, or a separately approved database restore under a write freeze. Do not
rename tables backward, delete new migration receipts, or run historical SQL to
simulate rollback. Mixed old/new export writers are not supported during cutover.

## Required fixtures

Fresh candidate; exact production SQL; legacy alias identities and actor-column
repair; unchanged scheduled subscription data; page null/empty metadata; deleted
identity guard; strict invalid/hybrid/no-secret/active-work rejection; repeated
execution; injected transactional rollback; preserved IDs/FKs/balances/ledgers;
and existing generation/cancellation/export/deletion regressions on PG16 and18.

## Local tooling and operator boundaries

- `bun run db:check-lineage` (or built `db:check-lineage:prod`) is a
  repeatable-read, database-enforced READ ONLY inspection. It emits lineage,
  static blocker codes and aggregate counts only, never row IDs, tokens, identity
  values or the configured secret. It does not create migration metadata.
- Ordinary `bun run migrate` cannot bridge production. The one-off explicit
  argument is `--production-lineage-bridge-quiesced`; it is an assertion by the
  authorized operator that all old application writers and workers, including
  push, deletion, generation/export dispatch and billing callbacks, are stopped.
  The runtime must already supply ACCOUNT_DELETION_IDENTITY_HASH_SECRET when
  existing deletion identities require backfill. Do not place secrets in CLI
  arguments, generate a replacement or rotate the existing key for this step.
- Apply this only during an approved write freeze after a restorable backup,
  fixture rehearsal and aggregate preflight. The prepass takes table write locks,
  uses a five-second lock acquisition timeout, repeats the checks under those
  locks and preserves the same physical export relation OIDs. This is not a
  zero-downtime migration or permission to run it against a live database.
- The compatibility prepass itself is one transaction. The remaining historical
  candidate migrations retain their existing per-file/no-transaction behavior.
  A failure after the prepass commits leaves its receipt and the completed file
  receipts intact. Keep writers stopped, fix the reported blocker and resume
  with the same explicit quiescence argument. Do not erase receipts or repeat old
  production SQL. The runner requires this acknowledgment until the release's
  files through 046 are complete, but does not impose it on later unrelated
  migrations.
- Exact common history, recognized aliases, required column types and primary
  keys, source unique-key/FK contracts, valid idempotency-index definitions and
  relevant row invariants are checked. Unknown or partial hybrid schemas fail
  closed. Source fixtures carry a commit marker and per-file SHA-256 manifest.
- A masked/deleted account without its original identity record is a hard
  blocker: a usable keyed tombstone cannot be reconstructed from a masked ID.
  Likewise, missing cancellation actors, mismatched existing tombstones, invalid
  encrypted-token records and incompatible upload lifetimes are reported rather
  than fabricated, rewritten or silently discarded.

No historical 001–041 file is edited. Migration 045 retains the production
scheduled subscription columns and values; 046 preserves them. No credentials,
provider calls, production connections or deployments are part of the rehearsal.

## Rehearsal evidence (2026-10-01)

All 38 frozen SQL fixtures match the recorded production Git source byte-for-byte
and have a tested SHA-256 manifest. Every successful production bridge fixture
runs the complete checkDeploymentDataInvariants function after all migrations,
including canonical/alias history, cancellation actor repair, metadata repair,
transaction rollback/retry and interrupted migration continuation. Fresh candidate
migration also runs the complete checker.

Negative fixtures prove unsafe rows remain unchanged and no bridge receipt or
export rename is written. A completed legacy request retaining its raw identity
is explicitly covered even when scheduled_asset_keys is empty. No successful
fixture silently rewrites or removes that unresolved evidence; successful seed
profiles have no unresolved completed deletion request.

The actual bun run db:check-lineage command was also exercised on a fresh local
PG16 database; inspection is read-only and creates no metadata. Current focused
PG16/PG18 test results are recorded in the final audit note below. Aggregate
release checks must still be rerun on the final integrated checkpoint.

## Auth-data preflight addendum

`users.email` must retain its supported TEXT/NOT NULL/unique schema. The bridge
also reports and blocks duplicate `lower(email)` groups among accounts that will
remain active after deletion-start timestamps are preserved/backfilled. This
matches UserRepository.findByEmail exactly; it neither trims/rewrites addresses
nor chooses, merges or removes accounts. Reports contain group counts only.
The negative fixture proves both case-variant users and their exact addresses
remain untouched and no bridge receipt or rename is written on rejection.

Legacy deletion review at source 2debe:
`src/routes/account.ts` authenticates POST /account/deletion and validates the
literal DELETE using `src/lib/validators/account.schema.ts`. The service checks
then-current subscription/confirmed-asset acknowledgements before claimRequest.
Thus a legitimate application-created pending record follows a confirmed request
path, but its acknowledged asset/subscription scope is not persisted. The old
repository's scheduled_asset_keys records lifecycle scheduling, while the new
recovery mapper treats that field as deletedAssetKeys and skips those keys.
These are not interchangeable proofs of completed exact-object deletion. No
migration may manufacture acknowledgements or assume scheduling means deletion;
legacy pending work needs explicit reconciliation before new recovery resumes.

The pre-bridge implementation now fails closed on every legacy
pending_external_action deletion request, and on every legacy request with a
nonempty scheduled_asset_keys inventory, including requests labeled completed
or blocked. The inventory remains byte-for-byte historical scheduling evidence;
it is not cleared, moved into deleted evidence, executed or marked complete.
These checks apply before the compatibility transaction and repeat under its
locks. A later fresh candidate deletion receipt is not classified as legacy.

These are mandatory data-safety gates with no force/bypass option. Reconciliation
must retain the original scheduling evidence separately and establish actual
object disposition and the applicable confirmed request scope before a reviewed
forward change can adopt such rows. A completed account request alone does not
prove exact-object deletion. This rehearsal neither contacts storage/identity
providers nor performs that external reconciliation.

The legacy S3 implementation was verified directly at production commit 2debe:
`src/infrastructure/aws/S3AccountAssetLifecycle.ts` uses GetObjectTagging and
PutObjectTagging with a pending-deletion tag. Physical removal belongs to the
bucket lifecycle rule; a successful scheduling call is not an exact-deletion
receipt. It also accepts a missing object as success, so historical per-key
outcomes cannot be distinguished from the stored array alone.

## Completed-receipt and stale-notification audit

The preflight rejects legacy completed deletion receipts if the existing
identity_key is absent, the original identity_id is still present, cancellation
or scheduled-asset inventories remain, required completion timestamps are
missing, or a processing claim remains. The predicate mirrors the final
account_deletion_requests.completed_scrub invariant. It does not scrub the row,
clear arrays, generate acknowledgement records or mark external actions complete.
A source status of completed alone is insufficient to make that transition.

Outstanding push deliveries must match the current terminal job state after the
known canceled-to-cancelled spelling normalization, and must not refer to a
cancellation request or canceled result. Otherwise the preflight emits only an
aggregate blocker. It neither marks the notice sent/dead nor deletes the old
outbox/delivery evidence. Adding the final invariant assertion exposed this case;
a dedicated negative fixture preserves it unchanged.

These audit corrections are mandatory gates without a force option. Earlier
fixture-only passes did not establish the completed-scrub invariant; the full
post-migration invariant assertion is now required for every success path.

Final audit verification: PG16 and PG18 each passed three focused suites /48
tests, including all 26 real production bridge cases. Successful upgrade cases
pass the complete final deployment data invariant checker. The raw-identity
regression covers both absent and already-correct identity_key values, with the
full original request row unchanged on rejection. The root TypeScript build and
`git diff --check` pass. No historical migration 001–041 was edited, no external
cleanup was performed, and no commit was created.
