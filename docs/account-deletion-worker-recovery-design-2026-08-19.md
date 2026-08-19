# Account-deletion worker recovery hardening (2026-08-19)

> **SUPERSEDED / NO-GO:** この artifact-only 設計の手順は現在すべて実行停止である。
> 稼働 API と worker の削除契約を同一 SHA へ前方移植する必要がある。実装・展開前に
> `account-deletion-contract-forward-port-design-2026-08-19.md` に基づく新runbookへ置換する。
> 本文の migration 037 や artifact gate を途中から再開してはならない。

## Purpose and scope

Restore a deployable account-deletion worker artifact without changing an
account-deletion request's destructive ordering, authorization, billing, or
production state. This change is limited to read-only artifact/deployment
preflight material for a separately operated worker release.

The deployed release image is not a recovery-worker artifact: it does not
contain `dist/scripts/startProductionAccountDeletionWorker.js`. Current
`origin/main` does contain that entrypoint and its recovery runner. The two
facts reconcile the apparent conflict: the deployed worker is obsolete, while
the current source contains a recoverable worker that must be built and
verified as its own artifact. An API image must not be substituted for it.

Migration 037 adds nullable `identity_key` and `next_retry_at` columns. The
reported production read-only preflight found zero `processing` and
`pending_external_action` rows, so this change intentionally adds no legacy
row repair or recovery data path. If any legacy row with a null identity key is
found later, stop the worker rollout and create a separately reviewed forward
repair; do not backfill or replay it through the worker.

## Spec basis and affected layers

- Unified Spec sections 3, 5, 8, 9, and 10: repository-owned persistence,
  opaque stored values, sanitized operational output, independent workers, and
  verified release gates.
- Affected layers: Docker image metadata, local operations preflight script,
  ECR lifecycle-policy example, unit tests, and deployment runbook.
- No Route, Mobile, Web, migration, production ECS, or task-definition change
  is in scope.

## Interface and security boundary

The artifact preflight accepts a dedicated ECR repository and immutable digest.
It reads ECR metadata and image layers only, verifies a Linux ARM64 manifest
and the worker entrypoint path, and validates one coherent lifecycle rule:
five retained images total (the current image plus four rollback images), with
an `expire` action and no earlier broad expiry rule. It does not push images,
register task definitions, change ECS desired count, or print ECR URLs,
digests, image labels, or application data.

## Test and verification plan

1. Add unit tests for the artifact-preflight parser and guard: a dedicated
   repository, an immutable digest, Linux ARM64 manifest, worker path, and a
   coherent retained lifecycle policy are all mandatory; outputs remain
   generic.
2. Run the focused tests, TypeScript build, Docker contract test, and the
   existing migration/invariant checks where local PostgreSQL is available.

## Delegation

No delegation: this is a small artifact preflight and runbook hardening change.
The required Sol/Terra task packet is executed locally because the lifecycle
guard and its release wording must remain one reviewable unit.
