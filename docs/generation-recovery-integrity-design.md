# Generation recovery integrity design

## Scope

This change hardens page and entity generation recovery without changing the
public generation APIs, queue payloads, job types, or existing credit pricing.

## Invariants

1. A refund is allowed only when a matching `consume` ledger entry exists.
2. A job can never be refunded beyond its consumed monthly and purchased
   bucket deltas, even when API and worker recovery run concurrently.
3. Organization refunds restore the original credit buckets instead of
   converting monthly credits into purchased credits.
4. Recovery may fail a job only if the job is still stale at the atomic UPDATE.
5. One broken recovery item must not block the rest of the batch.
6. Page and entity workers both publish progress heartbeats while external
   generation and storage calls are in flight.
7. Production startup and worker recovery use the same organization-aware
   refund service as request-scoped recovery.
8. Organization usage records retain the generation job identifier.

## Layer responsibilities

- `OrganizationService`: transactionally calculate remaining refundable bucket
  deltas under the organization balance row lock.
- Recovery repositories: select only consumed-but-not-fully-refunded jobs and
  atomically re-check stale state while transitioning a job to `failed`.
- Recovery services: isolate failures per job and leave failed refunds eligible
  for a later pass.
- Execution repositories/workers: expose and maintain entity progress
  heartbeats using the existing `generation_jobs.result` JSON field.
- Runtime composition: inject `OrganizationService` into startup and periodic
  recovery paths.
- Route audit helper: retry transient audit writes and surface a structured
  operational error after exhaustion; mutation services remain authoritative.

## Compatibility

- No request/response shape changes.
- No queue payload changes.
- No destructive migration or existing migration edits.
- Existing historical ledger rows without bucket deltas remain readable.
- Personal credit behavior remains unchanged.

## Tests

- Organization refund: no consume, duplicate/concurrent refund, partial refund,
  and monthly/purchased bucket restoration.
- Recovery SQL: consume ledger requirement and stale predicate propagation.
- Recovery service: per-item exception isolation.
- Entity worker: heartbeat starts, repeats, and stops on success/failure.
- Runtime composition and organization usage job linkage.
