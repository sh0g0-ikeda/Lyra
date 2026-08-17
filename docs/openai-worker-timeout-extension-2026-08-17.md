# OpenAI worker timeout extension - 2026-08-17

## Purpose and scope

Extend the production generation worker's per-request OpenAI timeout from five
minutes to ten minutes so a long whole-episode planning response can complete.
The change is limited to the worker runtime configuration.

The following are intentionally out of scope:

- API runtime timeout changes
- OpenAI retry, model, prompt, or structured-output changes
- generation job, cancellation, credit, database, or persistence changes
- Web, iOS, Android, or EAS releases

## Spec basis

This follows `docs/Lyra_Unified_Spec_v4.md` sections 6, 8, and 9 and
`docs/Lyra_StoryAI_SubSpec.md` section 7: provider calls remain bounded, SQS
visibility remains coordinated with the provider timeout, and generated output
is still validated before the existing atomic commit.

## Design

`OPENAI_TIMEOUT_MS=600000` is already accepted by `src/lib/env.ts`. Production
loads shared values from `lyra/prod/app`, but changing that JSON would also make
future API processes inherit the ten-minute timeout. Instead, register a new
worker task-definition revision with the environment override
`OPENAI_TIMEOUT_MS=600000`. `loadRuntimeSecretEnv` preserves an existing process
environment value, so the worker override wins without changing the shared
secret. The API remains on its existing five-minute value.

No container image or source behavior changes are required. The new worker task
definition must be identical to the current revision except for this one
environment value.

## Safety and availability

- The production SQS visibility timeout must remain 1,800 seconds. The runtime
  minimum is `max(1800, OpenAI timeout + 120 seconds)`, so a 600-second request
  remains within the existing envelope.
- The poller continues extending message visibility every 900 seconds.
- The 45-minute stale threshold remains unchanged.
- Roll out only while the queue and active generation-job set are empty, because
  replacing a worker during an in-flight provider request can terminate it.
- Do not expose the shared secret or OpenAI key in logs, task-definition output,
  or this document.
- Rollback is the previous worker task-definition revision.

## Verification

This is a production wiring-only change; the source already accepts the target
value, so there is no meaningful failing unit test to add before the operation.
The TDD exception is limited to this external runtime override.

Before rollout:

1. Verify the current worker revision, service health, queue counts, and active
   job count.
2. Run the existing env and runtime-guard tests proving the configured upper
   bound and SQS safety contract.
3. Register the cloned worker revision and confirm the diff contains only
   `OPENAI_TIMEOUT_MS=600000`.

After rollout:

1. Wait for the worker service to stabilize.
2. Verify the running task uses the new revision and the safe effective values
   `600000 / 1800` without printing other environment values.
3. Confirm queue and dead-letter queue counts, startup logs, and fresh worker
   errors remain healthy.
4. Keep the previous task definition as the immediate rollback target.

## Terra delegation

Terra independently audits the configuration surface, live rollout requirements,
and timeout/SQS/stale-job interaction. Sol owns the final task-definition diff,
production mutation, verification, and rollback decision.

## Applied production state

Applied on 2026-08-17 JST after confirming zero queued, in-flight, delayed, and
dead-letter messages and zero queued/processing `generation_jobs` rows.

- Previous worker task definition: `lyra-prod-worker:68`
- Current worker task definition: `lyra-prod-worker:69`
- Intentional task-definition difference: worker environment override
  `OPENAI_TIMEOUT_MS=600000`
- Container image, command, IAM roles, CPU, memory, network mode, runtime
  platform, shared secret reference, and all other container settings: unchanged
- API task definition and shared Secrets Manager JSON: unchanged

Post-rollout verification:

- ECS rollout: `COMPLETED`, desired/running/pending `1/1/0`, failed tasks `0`
- Runtime-only verification task: `OPENAI_TIMEOUT_MS=600000` and
  `SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS=1800`
- Generation queue and DLQ: visible/in-flight/delayed all `0`
- New worker log: `polling started`
- Worker error events after the new task started: `0`
- Public API health: `ok`

Immediate rollback remains `lyra-prod-worker:68`.
