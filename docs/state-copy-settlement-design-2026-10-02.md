# State reference copy settlement and account deletion

## Scope and status

This is a local safety follow-up to frozen release candidate
`1d512194dd0ee506102adc8bb773c2dfcaba28a8`. It does not enable state features,
change a production account, contact AWS, or certify deployment readiness.
The implementation uses the existing generation-job JSON record; no migration
silently classifies old history as safe.

Safety against the fault interleavings below is testable with disposable
PostgreSQL and a delayed in-memory object store. Availability/recovery of an
indeterminate external operation remains a release gate. A blocked deletion is
an intentional safe outcome, not proof that account erasure completed.

## Failure reproduced before the fix

The previous implementation committed exact-key copy intent and then held the
user, reference-set, state and job locks across storage copy and descriptor
commit. Two distinct failures invalidate lock-only protection:

1. PostgreSQL loses the transaction connection while the copy is outstanding.
   The database releases locks although the remote operation may continue.
2. The storage SDK rejects its local request on a lost response or abort while
   the independently accepted remote write may still finish later. Rollback
   releases healthy database locks too.

Deletion can then delete the destination (even before it exists), checkpoint
that exact key and clear personal job metadata. A later copy recreates the saved
object. The old tests covered callback failure and transaction failure but did
not independently schedule local request settlement and remote object mutation.

The new failing-first reproduction paused a fake remote mutation after request
admission, terminated the actual PostgreSQL backend or rejected the local
request, and invoked the real deletion service/repositories. The previous code
returned `completed` before the remote write was released. Both cases now block.
No assertion depends on a timing sleep or on a real cloud provider.

## Durable state machine

Each `generation_jobs.result.state_reference_copies` entry contains:

- `s3_key`, `entity_id`, `state_id`, `ref_id`: exact server-derived destination
- `attempt_id`: a fresh UUID owned only by this confirmation invocation
- `state`: `unresolved`, `succeeded` or `not_dispatched`

Under the user deletion-admission lock, validate the actor, scope, preview,
state revision, base reference and existing history before committing an
`unresolved` entry. After that commit, no disappearance of a process, connection,
lock, timeout or lease can erase the fence.

The second transaction revalidates all inputs and ownership of the exact attempt
before invoking storage. The state-copy adapter uses a dedicated single-attempt
client and requires the complete successful CopyObject result; HTTP 200 alone
or success of a retry is insufficient. The callback has no timeout race that
returns while its local operation remains detached.

Only these transitions are permitted:

- `unresolved -> succeeded`: this invocation received its one attempt's complete
  positive completion response. Persist this with the descriptor. If that
  transaction fails, this same invocation can persist its positive evidence
  using a fresh connection, targeting only its exact token and destination.
- `unresolved -> not_dispatched`: this invocation can prove it never invoked the
  copy callback. This covers second-stage validation failure and a lost first-
  stage COMMIT acknowledgement before phase two. Recovery targets only its own
  fresh token. It cannot clear another pending attempt.

A failed settlement write leaves the entry unresolved. A later API retry cannot
reconstruct the lost evidence. A persisted `succeeded` entry can reuse its exact
saved image to retry descriptor persistence without issuing another copy. A
persisted `not_dispatched` entry permits a new, separately identified attempt.

Unknown state, missing or malformed IDs, malformed history, duplicate attempt
IDs, invalid scope/key combinations and old entries lacking classification are
unsafe. A matching current descriptor does not classify legacy history. The
TypeScript parser and shared SQL predicate are exercised by parity tests.

## Deletion and retention boundaries

Unresolved/unknown personal copy history contributes to the existing active-job
blocker count, preserving the API response shape. The count is rechecked under
the user lock at deletion claim and finalization. Recovery also checks blockers
before subscription cancellation, asset deletion, anonymization or identity
operations. A prior deleted-key checkpoint cannot stand in for copy settlement.

Exact saved keys remain retained for image pruning and generation-job pruning.
Even malformed history is retained for investigation rather than discarded.
Personal deletion continues to exclude organization and foreign-owner keys.

The deployment invariant uses the same unsafe-history predicate. Existing
production-lineage prerequisites that reject pending or asset-checkpointed
legacy deletion receipts remain mandatory. Clearing a legacy copy flag alone
must never authorize replay of an old deletion receipt: its earlier deleted-key
checkpoint may predate a late write. No automatic legacy reconciliation was
added here.

## Deterministic verification

The tests cover:

- Real PostgreSQL backend termination during an independently delayed write
- Local request rejection before remote mutation, including an object appearing
  later and an arbitrarily old job timestamp
- Repeated confirmation blocked while original outcome is unresolved
- Positive completion of the original attempt after DB loss, durable settlement
  via a fresh connection, and subsequent exact-key deletion
- Failed descriptor commit with durable success reuse and no second copy
- Lost descriptor COMMIT acknowledgement and idempotent replay
- Failure of both descriptor persistence and settlement persistence, preserving
  the unresolved fence
- Lost admission COMMIT acknowledgement, token-specific `not_dispatched`
  recovery, and fail-closed behavior if that recovery database is unavailable
- Pre-dispatch failure that clears only its own fence while another remains
- Legacy history blocked despite an already matching live descriptor
- Both claim and finalization blocked, including after a deleted-key checkpoint
- Recovery paused before external side effects when a legacy claim is fenced
- Normal lock serialization, stale state rejection, competing candidates,
  namespace validation, image/job retention and native Bun/Vitest compatibility

## Remaining recovery and rollout gate

A process crash after remote success but before receiving or persisting that
success can leave an unresolved fence indefinitely. That is intentionally safer
than deleting metadata and declaring erasure complete while a write might still
occur. There is no automatic recovery policy for that ambiguity in this change.

Elapsed time, SDK abort, HEAD existence or absence, a successful later copy, and
replaying deletion do not prove the original attempt settled. The current storage
callback does not transmit `attempt_id` as a provider receipt, so the database
UUID alone cannot establish remote completion. A future reviewed design may use
an immutable unique-attempt object and verifiable token-bound completion
receipt, with a justified protocol for original-request termination, but that
protocol is not present or certified here.

Before enablement, review recovery/operations behavior, verify the production
single-attempt storage wiring and response handling, reconcile legacy records
without guessing, and perform authorized staging acceptance against actual
storage semantics. Keep state flags OFF. Existing preview confirmations are not
made inaccessible merely by disabling new preview generation, so rollout must
also account for old issued jobs and old processes.
