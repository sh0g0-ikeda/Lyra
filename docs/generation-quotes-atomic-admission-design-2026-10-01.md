# Atomic generation quotes (default off)

Approved scope: additive server quotes for page generation/regeneration, base and
state preview, and upload-backed import analysis. Existing clients and jobs retain
their legacy behavior. Pricing stays page 3 + max(0, distinct references - 3), and
preview/state/import 1. Only the existing GPT model and medium image quality are
available; no provider fallback or new signing credential is introduced.

## Transaction and execution boundary

An opaque, random quote token references server-owned immutable quote data. Its
hash, authenticated actor/workspace, operation/target, resource revision, exact
references, provider model, quality, render style, tariff version and price are
persisted. Public responses never expose prompts or storage keys. Quotes expire
in five minutes; accepted receipts remain reconcilable independently of expiry.

Acceptance locks the account, quote, capacity/admission and target graph in a
consistent order, repeats ownership/membership/freshness checks and creates the
legacy-compatible generation job, personal or organization credit debit/ledger,
page transition and durable dispatch intent in ONE PostgreSQL transaction. A
unique actor/workspace request key and quote row lock make duplicate acceptance
return one job and debit. Any failure rolls back the entire admission. A timeout
is reconciled through the scoped quote receipt, never treated as proof of no debit.

Workers use the immutable accepted snapshot. They verify the pinned configured
model and tariff rather than rereading mutable content or silently switching
models. The exact page reference snapshot is retained in the existing job result
inventory before queue dispatch. Legacy jobs with no quote remain unchanged.

Dispatch is leased, bounded and retryable. Queue acknowledgement uncertainty can
redeliver the same job ID; existing job claims prevent duplicate execution. A
periodic worker pass and receipt lookup recover pending dispatches. Failed or
cancelled jobs use existing job-scoped idempotent refund accounting.

Import's new quoted path is job-based; the old synchronous route is untouched.
A verified upload token plus object fingerprint pins its source. Acceptance
consumes that token in the admission transaction. The import worker validates
bytes/ETag, checkpoints its exact stabilization destination before copying, then
analyzes and persists the result. Repeated processing never repeats a completed
analysis. A stopped/unknown worker is failed and refunded once instead of blindly
re-executing a potentially completed provider request. Account deletion and image
cleanup cover the source, copy intent, completed image and new job type.

## Gates and verification

GENERATION_QUOTES_ENABLED defaults to false. Existing generation/import/state
flags remain authoritative too. Public quote acceptance stays unavailable until
all runtime wiring, queue dispatch, snapshots and settlement are present and tested.
No production migration, provider request, tariff change, credential or deployment
is part of this work.

TDD covers exact tariffs, request strictness, expiry, scope/role changes, stale
content/reference/model/style/tariff, duplicate and concurrent acceptance, unknown
receipt recovery, low balance/capacity, rollback injection, queue uncertainty,
worker pinning, import failure/recovery, privacy cleanup and legacy compatibility
on PostgreSQL 16 and 18.

## Preserved imported-source preview

`entity_preview` additionally accepts the existing opaque `source_candidate_token`
(mutually exclusive with `source_ref_id`). Existing v1 tokens authenticate actor,
exact entity, object key and expiry; target workspace and type are resolved from
current authorized entity data rather than invented token fields. Empty-entity
and other-actor/entity tokens cannot be rebound. Only verified decoded metadata is
stored, never the bearer token or a client-supplied storage key. The source MIME,
size and SHA-256 are pinned and rechecked at acceptance and execution; quote expiry
is capped by token expiry. Job source inventory retains the owned image for
existing pruning and personal account-deletion safeguards.

## Local verification checkpoint

- Policy, route, source-token and worker focused suite: 95 passed on PG16
- Quote integration: 15 passed on PG18, including source bytes/expiry, exact scope,
  quote replay, queued receipt uncertainty, legacy admission lock ordering,
  source changes, import stop/refund, and storage retention
- Complete integration suite: 12 files / 97 tests passed on PG16 at this checkpoint
- Adapter-sourced output provenance: 81 focused adapter/repository/worker tests
  passed after a failing-first provenance assertion
- Earlier complete backend unit checkpoint: 283 files / 2,020 tests passed
- A later whole-unit run passed 2,050 tests with three failures only in concurrent
  production-billing tests being introduced by the billing owner; those are not
  represented as a final green release gate
- Existing candidate/backend source checks passed before concurrent auth/billing
  changes; final aggregate build, contract regeneration and full tests must be
  repeated after all owners finish

No provider request, production database connection/migration, IAM change, tariff
change, flag enablement or deployment was performed. The production lineage bridge
is a separate required local rehearsal before this candidate can be released.
