# Worker autoscaling maximum 5 rollout

## Purpose and scope

Increase the production generation worker ceiling from 3 tasks to 5 tasks while
preserving the existing daytime and overnight minimums:

- 09:00-24:00 JST: minimum 1, maximum 5
- 00:00-09:00 JST: minimum 0, maximum 5

This is an operations-only capacity change. It does not change job admission,
the shared SQS contract, worker concurrency, provider retry behavior, credits,
database persistence, API responses, Web, or Mobile binaries.

## Specification basis

`docs/Lyra_Unified_Spec_v4.md` sections 6 and 9 require queued generation,
independent worker scaling, and queue-depth/oldest-message observability. Story AI
rate limiting and active-job uniqueness remain governed by
`docs/Lyra_StoryAI_SubSpec.md` section 7.

## Design

Update all three AWS capacity surfaces so a scheduled action cannot reset the
ceiling to 3:

1. ECS Application Auto Scaling target: min 0, max 5.
2. Daytime scheduled action: min 1, max 5.
3. Overnight scheduled action: min 0, max 5.

Keep the existing scale-out policy unchanged: one additional task per alarm
action, 60-second cooldown, triggered by at least one visible SQS message. This
keeps provider and database load ramp-up gradual. The user-facing goal of starting
a normally queued job within about five minutes is a best-effort objective, not a
hard SLA; a burst requiring several successive scale-out actions or five already
busy workers can exceed it.

## Security and safety

- Do not output or modify application secrets.
- Do not change IAM, task definitions, container images, queues, or DLQs.
- Do not purge messages or terminate running tasks.
- Preserve scale-in protection based on both visible and in-flight messages.
- Apply only after confirming the current service and queue are healthy.

## Verification

- Read back scalable target min/max.
- Read back both scheduled actions.
- Confirm scaling policies and alarms are unchanged.
- Confirm ECS desired/running/pending counts did not unexpectedly change.
- Confirm generation queue and DLQ counters remain healthy.
- Record the applied state and rollback values below.

## Rollback

Restore the scalable target and both scheduled actions from maximum 5 to maximum
3, retaining the same minimums and cron schedules.

## Applied state

Applied on 2026-08-18 at 00:58 JST.

- Scalable target: minimum 0, maximum 5.
- Daytime scheduled action: minimum 1, maximum 5.
- Overnight scheduled action: minimum 0, maximum 5.
- Scale-out policy remained `ChangeInCapacity +1` with a 60-second cooldown.
- Scale-in policy remained exact capacity 0 after the combined visible and
  in-flight queue metric is empty for 15 consecutive one-minute periods; the
  scheduled minimum still bounds the effective daytime capacity at 1.
- ECS worker remained desired/running/pending `0/0/0` during the overnight
  empty-queue verification, with rollout `COMPLETED` and failed tasks `0`.
- Generation queue and DLQ visible/in-flight/delayed counters remained `0/0/0`.
