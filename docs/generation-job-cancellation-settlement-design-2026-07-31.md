# Generation job cancellation settlement design

Date: 2026-07-31

## Purpose and scope

This change generalizes cooperative cancellation from
`episode_story_autofill` to the four current `generation_jobs` types without
allowing a cancelled job to consume credits, persist a generated result, or
emit a terminal push event.

Included:

- scoped cancellation of queued and processing generation jobs;
- transactional cancellation/refund settlement for personal and organization
  balances;
- worker checkpoints and an explicit commit-start barrier;
- page-state restoration for cancelled page generation;
- safe separation of page-skeleton AI preparation from persistence;
- a default-off flag for cancellation outside episode story autofill.

Excluded from this PR:

- APNs/FCM delivery and mobile notification permission UI;
- terminal push-outbox connection and retry-attempt identity;
- production migration execution or feature-flag enablement.

Those remain separate because notification delivery has independent provider,
lease, and rollout contracts.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` §6: active/terminal job states,
  cooperative cancellation, `commit_started_at`, active uniqueness, retry and
  refund coordination.
- §7: transactional credit row locking and idempotent failed-job refunds.
- §8: bounded validated inputs and sanitized errors.
- §10: Vitest/Bun, migration/invariant, build, frontend, and Playwright gates.

## Affected layers and interfaces

- Domain/config: a default-off generic cancellation feature flag.
- Route: no wire-shape change; the existing authenticated and
  organization-capability-scoped cancel route is reused.
- Service: `JobService` authorizes supported job types; page/entity/skeleton
  workers check cancellation before expensive work and before persistence.
- Repository: `GenerationJobCancellationRepository` owns scoped request,
  cancellation settlement, refund, page compensation, and the commit-start
  compare-and-set.
- Migration: a new migration protects late credit consumption after a
  cancellation request. Applied migrations 001-037 are not edited.
- Worker: the same repository control is injected into page, entity, and
  skeleton workers. Existing episode-story atomic persistence remains intact.

## Transaction and race contract

1. Credit consumption already locks the personal or organization balance
   before inserting its ledger row.
2. A new ledger guard locks the referenced generation job after that balance
   lock and rejects consumption if cancellation evidence exists.
3. Cancellation performs the same balance-then-job lock order. Queued jobs
   become `cancelled` immediately; processing jobs first record a request.
4. Worker settlement locks balance then job, changes the job to `cancelled`,
   restores a generating page to its server-recorded previous state, and
   refunds only the remaining consumed amount in one transaction.
5. `beginCommit` atomically wins only while a processing job has no
   cancellation request. Workers call it before the first irreversible write:
   page/entity object storage, page-skeleton persistence, or the existing
   story-plan persistence gate.
6. Completion/failure writes reject cancellation evidence. A provider error
   racing with a cancellation is settled as cancellation, not failure.

The page enqueue flow updates the page to `generating` before credit
consumption. If cancellation wins before or during consumption, the guarded
consume fails and existing enqueue compensation restores the page. If it wins
after consumption, cancellation itself restores the page. This closes the
previous create-consume-enqueue window without a late-refund trigger.

## Security and integrity controls

- The route keeps authentication, UUID validation, organization membership,
  and `edit_work` capability checks.
- SQL remains parameterized and rechecks personal/organization scope inside
  the row-locking transaction.
- Refunds are capped by scoped consume-ledger totals minus prior refunds.
- Organization cancellation audit rows use the authenticated requester.
- Raw database/provider errors are not returned to clients.
- Generic cancellation defaults off so deployment does not broaden current
  production behavior until migrations, invariants, and rollout checks pass.

## TDD and verification

Tests are added before behavior changes for:

- queued and processing cancellation for each supported job family;
- personal and organization refund capping/idempotency;
- late consume rejection and balance/job lock order;
- cancellation versus `beginCommit`;
- page state restoration;
- page/entity/skeleton worker checkpoints and provider-error races;
- page-skeleton preparation without persistence before the commit gate;
- migration contract and deployment invariants.

Run focused Vitest tests first and observe the expected failures. Before PR
integration run full Vitest and Bun suites, fresh PostgreSQL migrations plus
invariants and race E2E, backend build, Web lint/build, Mobile checks, and
Playwright smoke tests.

## Orchestration

No delegation. The current orchestration policy does not permit proactive
sub-agents, and the credit lock order, worker barrier, and compensation paths
form one tightly coupled safety decision. The Terra fallback checklist is:

- inspect only the listed cancellation/credit/worker paths;
- do not touch production, secrets, Docker configuration, or unrelated UI;
- prove each race with a focused test before integration;
- review the final diff and full verification evidence from the exact head.
