# Lyra production cost cuts 2/3/7 - 2026-06-22

This document records the pre-change state, design, rollback plan, and verification for the low-risk cost reduction work requested for items 2, 3, and 7.

## Scope

The requested items are:

2. Shorten the always-on worker window.
3. Add S3 lifecycle rules for image storage.
7. Move ECS Fargate tasks to ARM64 when safe.

No application behavior, database schema, billing logic, prompt compiler, or generation pipeline code should be changed by this work.

## Pre-change state

Git:

- Base branch before this work: `chore/cloud-ops-guardrails`
- New work branch: `chore/cost-cuts-2-3-7`
- Pre-change documentation commit available before cloud changes: this document.
- `docs/Lyra_Unified_Spec_v4.md` was not present in the repository, so the current cloud state and existing production docs are treated as authoritative.

ECS:

- Cluster: `lyra-prod`
- API service:
  - Service: `lyra-prod-api`
  - Task definition before ARM64 work: `lyra-prod-api:17`
  - Desired/running/pending at inspection: `1 / 1 / 0`
  - Runtime platform: `LINUX / X86_64`
  - Image: `452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-api:stuck-fix-20260616-0200`
  - Size: `256 CPU / 512 MB`
- Worker service:
  - Service: `lyra-prod-worker`
  - Task definition before ARM64 work: `lyra-prod-worker:3`
  - Desired/running/pending at inspection: `0 / 0 / 0`
  - Runtime platform: `LINUX / X86_64`
  - Image: `452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-worker:stuck-fix-20260616-0200`
  - Size: `1024 CPU / 2048 MB`

Worker scheduled scaling before item 2:

- `lyra-worker-jst-noon-min1`: `12:00-24:00 JST`, `MinCapacity=1`, `MaxCapacity=1`
- `lyra-worker-jst-midnight-min0`: `00:00-12:00 JST`, `MinCapacity=0`, `MaxCapacity=1`
- Queue reactive scaling was already present:
  - Scale out when `lyra-prod-generation` has visible messages.
  - Scale in after visible + in-flight messages remain zero.

S3:

- Bucket: `lyra-prod-images-452284481392`
- Lifecycle before item 3: no lifecycle configuration.
- Latest observed bucket metrics:
  - Standard storage: about `111,517,765` bytes.
  - Objects: about `54`.

Image architecture:

- Current ECR image tag `stuck-fix-20260616-0200` is an OCI index containing `linux/amd64` only plus attestation metadata.
- ARM64 requires building and pushing a new `linux/arm64` image before ECS service task definitions can be changed safely.

## Design

### Item 2: worker window

Change the always-on worker window from `12:00-24:00 JST` to `15:00-24:00 JST`.

Rationale:

- Keeps high-usage evening hours fast.
- Reduces always-on worker hours from 12 hours/day to 9 hours/day.
- Generation remains available outside this window because SQS queue depth can still scale the worker from 0 to 1.

Rollback:

- Restore `lyra-worker-jst-noon-min1` to `cron(0 12 * * ? *)`, `MinCapacity=1`, `MaxCapacity=1`.

### Item 3: S3 lifecycle

Add lifecycle rules that do not delete active/current objects immediately:

- Abort incomplete multipart uploads after 1 day.
- Expire noncurrent object versions after 30 days if versioning is enabled later.
- Transition noncurrent object versions to Glacier Instant Retrieval after 7 days if versioning is enabled later.
- Add conservative current-object transitions only for archival prefixes when those prefixes exist:
  - `archive/`
  - `deep-archive/`
  - `tmp/`
  - `imports/tmp/`

Rationale:

- The current bucket is small, so the immediate savings are limited.
- Rules are designed to prevent future storage growth without breaking current image URLs.
- Avoid deleting current production images by default.

Rollback:

- Remove the lifecycle configuration, or replace it with a narrower version.

### Item 7: ARM64 Fargate

Use a staged approach:

1. Build and push new ARM64 images with a unique tag.
2. Register new task definition revisions with `runtimePlatform.cpuArchitecture=ARM64`.
3. Update the API service first and verify `/healthz`, target health, and logs.
4. Update the worker service after the API is healthy.
5. Keep previous X86_64 task definitions for rollback.

Rationale:

- Existing production image is amd64-only.
- ARM64 task definitions cannot safely run the current image tag.
- Staged deployment limits blast radius and keeps rollback straightforward.

Rollback:

- API: update `lyra-prod-api` back to `lyra-prod-api:17`.
- Worker: update `lyra-prod-worker` back to `lyra-prod-worker:3`.

## Verification plan

After each item:

- Inspect AWS configuration with AWS CLI.
- Check that no unrelated production resource changed.
- Check relevant health state:
  - ECS service desired/running/pending.
  - ALB target health for API changes.
  - SQS queue and worker state for worker changes.
  - S3 lifecycle readback for lifecycle changes.

Final audit:

- Re-read ECS services, scheduled actions, task definitions, S3 lifecycle, CloudWatch alarms, and app `/healthz`.
- Record any issue found and fix it before considering the work complete.

