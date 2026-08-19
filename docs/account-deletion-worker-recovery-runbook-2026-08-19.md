# Account-deletion worker recovery runbook (2026-08-19)

> **SUPERSEDED / 全手順無効:** 現在の production API とこの worker の削除契約は一致して
> いない。`account-deletion-contract-forward-port-design-2026-08-19.md` に対応する新runbookへ
> 置換されるまで、本文を途中から再開してはならない。migration 037、image build、task
> definition 登録、desired count 変更を含む全手順が実行停止である。

## Safety boundary

This runbook is for a human operator with the approved production role. This
source change does not execute database rewrites, migration-history edits, ECS
service repointing, task-definition registration, or desired-count changes;
each remains a separate approved operator action. Do not substitute the API
repository or an image tag for the dedicated worker image and immutable digest.

The source preflight and all database queries below output only aggregate
counts, age buckets, migration/schema presence, and pass/fail results. Do not
add user IDs, emails, identity IDs, subscription IDs, S3 keys, secrets, ECR
download URLs, digests, or provider errors to tickets or logs.

## Build artifact gate

1. Build from a clean reviewed commit that contains migration 037 and
   `scripts/startProductionAccountDeletionWorker.ts`. Pass the reviewed commit
   SHA as the Docker build argument `SOURCE_REVISION`; the runtime image must
   carry it as `org.opencontainers.image.revision`.
2. Push the image to a repository whose name contains `account-deletion` and
   is not the shared API repository. Record its immutable digest outside this
   repository's source history.
3. Apply the reviewed lifecycle policy in
   `ops/ecr/account-deletion-worker-lifecycle-policy.json` to that dedicated
   repository. It retains five images total: the current worker image plus
   four immutable rollback images. Do not use a latest-10 shared API lifecycle
   rule or add another lifecycle rule to this dedicated repository.
4. In a local operator shell, set only these non-secret identifiers and run:

   ```powershell
   $env:ACCOUNT_DELETION_ECR_REPOSITORY = '<dedicated worker repository>'
   $env:ACCOUNT_DELETION_IMAGE_DIGEST = '<sha256 digest>'
   $env:ACCOUNT_DELETION_IMAGE_SOURCE_REVISION = '<reviewed source SHA>'
   npm run ops:preflight-account-deletion-worker
   ```

   The command reads ECR only. It confirms that the exact digest still exists,
   selects a Linux ARM64 manifest, reads its layers to find
   `dist/scripts/startProductionAccountDeletionWorker.js`, checks the source
   revision image label, and requires one coherent lifecycle rule retaining at
   least five images total (current plus four rollback images) with an
   `expire` action. It reports a generic pass/fail result only.

## Data stop condition

The reported production read-only preflight found zero unresolved
`processing` and `pending_external_action` rows. This artifact-only change
does not add a legacy-row recovery or identity-key backfill path.

For any future worker rollout, a separately approved read-only query must
return only:

- count and oldest age of `processing` and `pending_external_action` rows;
- counts grouped by the bounded `last_failure_code` values;
- migration 037 presence and required columns, index, and write-guard
  triggers.

If migration 037 or any required schema object is absent, stop. Use the normal
reviewed one-off migration process after its invariant checks; never insert a
schema-migration history row or patch a request by hand. If any legacy row has
a null identity key, stop and request a narrowly reviewed forward repair rather
than using the recovery worker to rewrite, backfill, or replay it.

## Deployment gate and rollback

After both gates pass, a human operator may create a new task-definition
revision by cloning the reviewed worker task's roles, secrets references,
networking, logging, CPU, memory, and shutdown behavior. Change only the
image to the verified dedicated-repository digest and keep desired count and
maximum concurrency at one. Verify stable `1/1`, the generic recovery startup
message, and aggregate recoverable-request age.

Do not use the old task-definition digests as rollback candidates: they are
known missing. Roll back only to a previously preflighted digest retained in
the dedicated repository. Alert on `TaskFailedToStart`,
`CannotPullContainerError`, desired-minus-running for two minutes, or a
recoverable-request age above 24 hours.
