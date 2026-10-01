# Gated local implementation of state-reference copy recovery

## Scope and status

This implementation work starts from the preserved, CI-green candidate
6c0c9681d8354ab2ed7cfbef51edf6990370930e in a separate branch. It implements the
protocol reviewed in `review/state-copy-recovery/実行前レビュー.md` for local
contract and disposable-database testing. The earlier packet's statement that
implementation had not been approved describes that earlier checkpoint. The
current authorization covers local implementation and verification only.

New admission defaults OFF. No AWS requests, credentials, IAM, bucket settings,
retention policy, deployment, store action, or paid provider call is part of this
work. Actual conditional-write enforcement, marker preservation and erasure
acceptance remain deployment prerequisites. An environment assumption supplied
to a mock or adapter is not proof that a real bucket satisfies it.

## Storage and identity

- A dedicated v2 namespace stores each image or its empty ordinary marker at the
  same immutable key. A fresh UUID prevents key reuse across attempts.
- Keys contain no raw owner/entity/job IDs. A SHA-256 of a versioned JSON tuple
  binds owner, entity, random attempt token and extension, allowing the existing
  synchronous scope validator to reject cross-owner/entity substitution.
- This is pseudonymization and integrity checking, not anonymity or access
  authorization. Someone with candidate identity IDs and a known key can test
  the association. Durable authorized descriptors and journal scope remain
  mandatory; the future marker retention decision must include that limitation.
- Both imported and generated source images are limited to the existing 5 MiB
  OpenAI reference-input ceiling. Bound actual streamed bytes; ContentLength,
  MIME, a path extension or a digest alone is insufficient source validation.
- Image writes use If-None-Match: *; recovery writes an empty ordinary marker
  using If-None-Match: * or atomically replaces the observed image using If-Match.
  Image-create and recovery capabilities are separate injected clients/ports.
- 409/412 require bounded reobservation. Errors, timeout, lost responses and
  mismatched metadata never become positive completion evidence.
- Versioned/suspended stores require complete bounded version enumeration,
  validation and exact image-version erasure while retaining the current marker.
  Unknown, locked or replica history remains blocked. Plain key deletion is
  never used for this namespace.

## Durable journal and concurrency

A new migration after immutable 046 adds a dedicated journal. It does not cascade
with users, works, entities, states or generation jobs. Each live attempt pins
actor/owner/organization, entity/state/job/candidate/source, revision/fingerprint,
base and descriptor, digest/MIME/size, source revision and storage evidence.

Admission and dispatch eligibility use the existing user → reference/state → job
lock order and the existing legacy-copy checks. The journal commits before any
write. An existing unresolved attempt is recovered, never blindly copied again.
A unique live job/candidate attempt and durable one-shot dispatch transition
prevent duplicate admission. Admission acknowledgement loss does not authorize a
new dispatch.

`fencing` is a durable state claimed before any external marker mutation. It
prevents a concurrent recovery from adopting an image that another process is
about to erase. `effects_fenced` requires both a valid ordinary marker and
completed historical image erasure, and is distinct from “never dispatched.”
A confirmed image may only be fenced under an authorized account-deletion claim;
ordinary stale retries must preserve images used by historical accepted jobs.

Image adoption and descriptor publication revalidate exact scope, token, key,
current revision, base, account state and journal transition in one transaction.
Storage success followed by DB failure stays recoverable and does not publish a
partial descriptor. Legacy v1 unknown attempts are neither converted nor cleared.

### Recovery before fresh confirmation validation

An authenticated confirmation first recovers at most one pending v2 attempt for
the exact organization, entity and state. Personal recovery additionally requires
the exact admitted actor/owner. This lookup checks current account and resource
authorization, but does not require an unchanged state,
ready base reference, current candidate or usable preview job. Recovery uses only
the stored descriptor, revision and intent; new request fields cannot amend them.
Successful adoption or fencing is followed by ordinary fresh-request validation.
Thus a new valid candidate can clear an older stale blocker without adopting that
older image as its own. A stale original request still fails freshness validation.
Confirmed historical rows are excluded from this preflight. Ordinary fencing
rechecks live authorization; an account-deletion claim instead authorizes durable
journal recovery even after the live entity or job has gone. Missing recovery
configuration, unknown storage outcomes and legacy unknown attempts remain held.
For organization assets, a current owner, admin or editor may fence an unresolved
attempt admitted by a former member, including after that member's deletion. The
recovering actor is authorized separately from the immutable admitted owner and
cannot adopt that other actor's image. Membership/capability and resource scope
are rechecked at the fence claim; viewers and cross-organization callers cannot
recover it. The current request then undergoes all normal candidate validation.
V2 admission, dispatch and image adoption also recheck and lock current editing
membership after the existing freshness/resource validator, so an editor-to-viewer
change during source loading or observation cannot authorize a subsequent write.
This capability check preserves the existing reference-before-state lock order.

## Existing consumers and deletion

The v2 namespace needs all of these integrations before its local path is called
complete:

- Journal-backed validity for state presentation, readiness, generation, accepted
  quote replay and authenticated export, including explicit stored ownership
  instead of inferring an owner from a path segment
- Legacy confirmation refuses a live v2 attempt, even when v2 intake is disabled
- Account deletion counts v2 assets for acknowledgement, claims a separate
  fence/purge phase, and rechecks durable evidence before personal finalization
- Every ordinary key-delete inventory excludes v2, and the generic S3 deleter
  refuses it defensively; existing deleted-key checkpoints are not v2 evidence
- Personal completion scrubs source/image/ownership payloads only after fencing
  is complete, retaining the minimal opaque marker receipt; organization assets
  stay outside personal deletion
- Ordinary image/job pruning cannot remove the marker, its only journal or active
  reference evidence. Deployment invariants diagnose inconsistent journal rows
- Every storage request consumes a bounded shared budget. Account deletion keeps
  its 25-external-step / 15-second attempt contract, including nested S3 requests

## Required local evidence

Use independently delayed mock remote writes and real PostgreSQL transactions.
Cover marker-first and image-first races, DB acknowledgement loss, stale state,
deleting accounts, concurrent confirmation/fencers, lost marker receipts,
wrong-token/scope/digest responses, bounded 409/412, unknown/locked version pages,
partial purge, OFF behavior, legacy holds, old API responses, quote/read ownership
and generic-pruner/deleter rejection. Keep failed attempts held when evidence is
incomplete. Run the existing full regression, migration and invariant gates on
the resulting exact candidate. Real S3, retention approval and production rollout
remain separate and unexecuted.

## Deployment validation extension

The migration adds a partial index on every non-null journal job ID, including terminal but unscrubbed attempts. Image/job pruning must preserve those durable anchors. Deployment checks retain the legacy-copy hold and additionally block unresolved/fencing v2 attempts during the required write freeze, reject canonical-key/scope mismatches, reject invalid confirmed-image evidence, reject visible state descriptors without an exact confirmed journal match, and reject personal journal metadata remaining after account completion. Historical confirmed rows need not equal the current editable descriptor; accepted quotes may still reference them. A missing entity/job is not by itself corruption because the journal must survive ordinary deletion. These SQL checks validate recorded evidence, not actual S3 retention or authorization policy.
