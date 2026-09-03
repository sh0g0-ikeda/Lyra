# Episode story-to-pages OpenAI model migration design

Date: 2026-09-03

Status: implementation-ready design; no model change has been applied yet

## 1. Decision

The first model migration is limited to the asynchronous
`episode_story_autofill` workflow exposed by
`POST /api/episodes/:id/autofill-pages-from-story`.

There is one required wiring isolation. The worker currently shares the same
`PageService` and episode compiler instances with the story-plan phase of
`episode_page_skeleton` when `apply_story_plan=true`. That skeleton path does not
pass the autofill execution control into `PageService` and can use a sequential
persistence path under current flag defaults. Changing it incidentally would
expand both risk and evaluation scope. The implementation therefore constructs a
second, legacy-profile `PageService` for that existing skeleton path. Its route,
job flow, behavior, and `gpt-5` model remain unchanged.

The target profile is:

| Stage | Current request | Target request | Why this model owns the stage |
|---|---|---|---|
| Full-episode beat and outline planning | `gpt-5`, provider-default reasoning | `gpt-5.6-terra`, `reasoning.effort=medium` | This stage assigns chronology and exclusive beat ownership across the complete episode. A quality failure propagates to every later page. |
| Page-detail expansion, including bounded repair recompilation | `gpt-5`, provider-default reasoning | `gpt-5.6-luna`, `reasoning.effort=medium` | This is the repeated, high-volume transformation stage. Its inputs, identifiers, output schema, and repair boundaries are tightly constrained. Luna's lower token price has the highest leverage here; lower elapsed time remains an evaluation hypothesis. |
| Complete-episode semantic audit and field-level repair proposal | `gpt-5`, provider-default reasoning | `gpt-5.6-terra`, `reasoning.effort=medium` | The auditor is the independent quality gate for cross-page continuity and must not share the detail stage's cost-first model. |

`gpt-image-2`, all `gpt-5.4-mini` uses, entity import, single-page autofill,
Story AI, and every other OpenAI call remain unchanged in this migration. The
unsuffixed `gpt-5.6` alias is forbidden because it resolves to GPT-5.6 Sol and
would violate the agreed cost/latency boundary.

This is a static per-stage profile. There is no prompt-dependent router, fallback
to a more expensive model, or model choice in the browser.

## 2. Goal and non-goals

### Goal

Improve the completed workflow as a whole across all four dimensions:

1. output quality;
2. elapsed time;
3. provider cost;
4. operational robustness.

The migration is promoted only when the same representative inputs show an
improvement under every release gate in section 10. A lower price in one stage
does not compensate for a quality, latency, or reliability regression elsewhere.

### Non-goals

- No Web or Mobile UI/source change.
- No public HTTP request field, response field/schema, status, or error-contract
  change. The value of the existing `compiler_model` field intentionally changes
  for target-profile results.
- No SQS message, job state, progress, cancellation, or error-code change.
- No change to adaptive packing, call order, audit pass count, retry policy,
  deterministic validation, or atomic persistence.
- No prompt text or prompt-version change, including the current prompt-safety
  instructions.
- No JSON Schema, Zod schema, identifier rule, page/panel merge rule, or output
  normalization change.
- No output-token-limit increase in the first release.
- No database migration and no rewrite of historical job metadata.
- No image-model migration.
- No production prompt caching, persisted reasoning, streaming, tools, service
  tier, or `reasoning.mode=pro` adoption.

Changing any item above would make the result harder to attribute to the model
swap and requires a separate design.

## 3. Spec basis and preserved flow

This design follows `docs/Lyra_Unified_Spec_v4.md` sections 3, 6, 8, 9, and 10:

- OpenAI remains an Infrastructure adapter behind existing Service ports.
- generation job admission, active uniqueness, SQS execution, timeout/retry,
  cancellation, recovery, and terminal settlement remain coordinated;
- all model output remains strict-schema and Zod validated before persistence;
- provider errors and content are not exposed to the client;
- the complete plan is still committed atomically after the fingerprint and
  cancellation gates;
- the full release verification gate still applies.

The externally observable control sequence and schema are unchanged; only the
existing compiler metadata value identifies the selected detail model:

```mermaid
flowchart LR
  UI[Web / Mobile] -->|same POST| API[API]
  API -->|same job params| Q[SQS]
  Q --> W[Generation worker<br/>episode story autofill]
  W --> B[Beat planning<br/>Terra]
  B --> D[Detail packs<br/>Luna]
  D --> A[Audit / bounded repair<br/>Terra]
  A --> P[Same deterministic gates<br/>and atomic persistence]
  P -->|same job contract| UI
```

The current variable call counts also remain intact:

- beat planning may use the existing capacity split and outline fallback;
- detail generation preserves the configured consecutive packing policy:
  adaptive packs when `EPISODE_PAGE_PLAN_ADAPTIVE_PACKING_ENABLED=true`, or
  fixed three-page chunks when it is `false`;
- audit uses the existing one required pass and at most one second semantic pass;
- provider transport and structured-output retries retain their current bounds.

Beat and audit are used when the existing
`EPISODE_PAGE_PLAN_CONTINUITY_V3_ENABLED` flag is true (the source default). If it
is false, the current legacy orchestration still runs only the detail compiler;
the model profile does not change that flag or branch.

## 4. Provider compatibility contract

GPT-5.6 Terra and Luna both support the already-used `/v1/responses` endpoint and
Structured Outputs. Therefore the request continues to send:

- `model`;
- the current `max_output_tokens`;
- the current `input` messages;
- `text.format.type=json_schema`, the same schema name/schema, and `strict=true`.

The only new payload member in the target profile is:

```json
{
  "reasoning": {
    "effort": "medium"
  }
}
```

The legacy profile omits `reasoning` so rollback recreates the present request
shape rather than imposing a new setting on `gpt-5`.

`max_output_tokens` includes visible output and reasoning tokens. The current
limits are retained to isolate the migration:

| Stage | Existing maximum |
|---|---:|
| Beat plan and outline | 32,000 |
| Detail page plan | 24,000 |
| Audit | 20,000 |

An increased `incomplete_details.reason=max_output_tokens` rate blocks promotion;
the first response must not be to silently increase these limits. After measuring
actual visible and reasoning usage, a separately reviewed change may adjust a
single stage's limit if necessary.

No `previous_response_id` is used, so no cross-call reasoning state is introduced.
Response extraction (`output_text` and output-item text), refusal handling,
incomplete classification, JSON normalization, Zod validation, and safe errors
remain unchanged.

Official references checked on 2026-09-03:

- [GPT-5.6 model migration guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT-5](https://developers.openai.com/api/docs/models/gpt-5)
- [Responses create reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)

## 5. Versioned configuration and rollback

Add one validated, non-secret environment setting:

```text
OPENAI_EPISODE_TEXT_PROFILE=legacy|balanced_v1
```

It defaults to `legacy`. Arbitrary model IDs are not accepted from environment
variables.

The profile registry is immutable and explicit:

```text
legacy
  beat   = gpt-5, reasoning omitted
  detail = gpt-5, reasoning omitted
  audit  = gpt-5, reasoning omitted

balanced_v1
  beat   = gpt-5.6-terra, reasoning medium
  detail = gpt-5.6-luna,  reasoning medium
  audit  = gpt-5.6-terra, reasoning medium
```

This single switch prevents a partially configured per-stage mixture and prevents
the accidental use of the `gpt-5.6` Sol alias. API and worker composition roots
resolve the same registry. A single uninterrupted execution inside one process
uses the profile captured when that process constructs its adapters.

The profile is not persisted into the job payload. During an ECS rolling deploy,
old and new tasks may therefore consume different jobs, and a job re-executed after
a worker loss may use the replacement worker's profile. This remains safe from
partial page writes because persistence is atomic, but each attempt must be
identifiable through the telemetry defined below. The rollout must never claim an
exact traffic percentage without isolated routing.

Rollback consists of setting both API and generation-worker task definitions to
`legacy` and rolling those tasks. Completed jobs are not rewritten. A failed job
subsequently retried by a legacy worker follows the existing retry/recovery rules.

Profile keys are append-only. If evaluation later proves that Luna `low` effort is
better for detail expansion, introduce a new key such as `balanced_v2_detail_low`;
do not silently alter `balanced_v1`.

## 6. Implementation boundaries

### New Infrastructure module

Add `src/infrastructure/openai/EpisodeOpenAIModelProfile.ts` containing:

- the narrow `OpenAIReasoningEffort` union;
- the typed beat/detail/audit request-profile shape;
- the immutable `legacy` and `balanced_v1` registries;
- a pure resolver for the validated profile key.

Add `src/infrastructure/openai/EpisodeOpenAIRequestTelemetry.ts` containing the
bounded trace/usage types and a structured-log sink. The sink accepts only the
allowlist below and is never passed prompt or output content.

Model IDs belong here because they are provider adapter configuration. Existing
prompt versions and output budgets stay in Domain constants.

### Existing backend files

The implementation is limited to:

| File or area | Change |
|---|---|
| `src/lib/env.ts`, `.env.example` | Add the two-value profile enum with the safe `legacy` default. |
| `src/infrastructure/openai/StructuredOpenAIResponse.ts` | Accept optional typed `reasoningEffort` and trace observer; serialize `reasoning: { effort }` only when present; send sanitized timing/request-ID/usage metadata to the observer without changing validated output or error classification. |
| `OpenAIEpisodeBeatPlanCompiler.ts` | Require the resolved beat profile and use its model/effort for both outline and beat requests. |
| `OpenAIPageEpisodePlanCompiler.ts` | Require the resolved detail profile and use its model/effort for initial packs and existing repair recompilation. |
| `OpenAIEpisodePlanAuditCompiler.ts` | Require the resolved audit profile and use the same model/effort on both existing attempts and both semantic passes. |
| the three internal compiler input ports and `PageService.autofillEpisodeFromStory` | Carry optional trace correlation and attempt/pass labels only; do not add a decision branch or change result types. |
| `EpisodeStoryAutofillWorkerService.ts` | Start the trace with the existing job/episode identifiers and retain the current execution and settlement order. |
| `src/app.ts`, `worker/dependencies.ts` | Call one pure compiler-profile factory shared by both composition roots. In worker composition, build the selected-profile `PageService` for autofill and a legacy-profile instance for the existing skeleton story-plan path; do not add a model branch inside either workflow. |
| startup logging | Emit the profile key, task/deployment revision, explicit model IDs, and efforts once per process, without prompts, story text, provider output, or secrets. |

Keep the three current episode `*_OPENAI_MODEL` constants as the source of the
`legacy` profile in this migration. Removing them is an unrelated cleanup. No
other model constant is touched.

### Explicitly unchanged files and layers

- `apps/web/**` and `apps/mobile/src/**`;
- public routes and request/response validators;
- SQS queue message schemas;
- `PageService` orchestration and business Service-port results; only optional,
  non-controlling trace context is threaded for telemetry;
- repositories, migrations, and database invariants;
- prompts, schema objects, sanitizers, and repair logic;
- `OpenAIClient` timeout and retry classification;
- image generators and `OPENAI_IMAGE_MODEL`.
- the page-skeleton model and its optional story-plan path, which remain pinned to
  the legacy episode profile in worker composition.

`compiler_model` remains a nullable string in the existing job/API contract. The
autofill result records the detail compiler model at top level. A target result
therefore records `gpt-5.6-luna`, while historical `gpt-5` values remain valid.

### Observability-only compatibility exception

Startup logging alone cannot attribute an execution after a rolling deploy. Thread
an optional internal trace context through `EpisodeStoryAutofillWorkerService`,
the existing `PageService.autofillEpisodeFromStory` call, and the three compiler inputs.
It contains only job ID, deployment revision, and profile key and must never affect
model selection, validation, retry, cancellation, or persistence.

Emit structured per-attempt/per-stage telemetry with this allowlist:

- job ID, episode ID, deployment revision, and profile key;
- stage (`beat`, `detail`, or `audit`), model, and effort;
- provider request ID when available, elapsed milliseconds, structured attempt,
  semantic pass, and sanitized outcome classification;
- aggregate input, cached-input, cache-write, output, and reasoning token counts
  when the provider supplies them.

Never log prompt/story/output text, schemas, API keys, user email, raw provider
errors, or the full Responses body. If usage is absent, record
`usage_available=false` instead of estimating it in production. Telemetry is
append-only observation; it does not add a database column or public API field.
The evaluator's instrumented transport, rather than production logs, is the
authoritative source for individual HTTP retry counts and billed cost.

## 7. Security and reliability analysis

- Authentication, ownership, organization scope, admission locking, and
  cancellation are upstream of the provider adapter and do not change.
- User story text remains untrusted prompt data under the current system prompts.
- Strict provider schema, Zod schema, contextual ID validation, deterministic
  continuity checks, and atomic persistence remain mandatory.
- No model can bypass immutable page IDs, panel orders, panel counts, allowed
  repair fields, or known entity/scene IDs.
- Provider 5xx, retryable 429, network error, timeout, quota/billing error, refusal,
  and incomplete responses retain their current classification.
- No model name, effort, or feature can be supplied by a browser request.
- Model IDs, efforts, and the telemetry allowlist above are safe to log; prompts,
  generated text, API keys, raw provider errors, and full Responses payloads are
  not logged.

The existing public progress normalization does not expose every internal
planning/audit stage. That is existing behavior and is deliberately not repaired
inside this migration.

Repository review also found a pre-existing contract gap: the
`episode_page_skeleton` `apply_story_plan=true` path does not pass the autofill
execution control to `PageService`, so it can persist story-plan fields
sequentially under current flag defaults. This migration neither hides nor repairs
that unrelated behavior; it pins the path to `legacy` and requires a separate
atomicity/cancellation design before extending the GPT-5.6 profile to it.

## 8. TDD plan

Implementation starts with failing tests. Documentation-only work in this change
is the AGENTS.md TDD exception; the later implementation is not.

### Provider request tests

1. `StructuredOpenAIResponse.test.ts`
   - target effort produces exactly `reasoning: { effort: 'medium' }`;
   - omitted effort produces no `reasoning` member;
   - all existing schema, input, output-limit, response, refusal, and safe-error
     behavior remains identical.
2. `OpenAIEpisodeBeatPlanCompiler.test.ts`
   - target outline and beat requests use Terra/medium;
   - legacy requests use GPT-5 and omit reasoning;
   - both keep 32,000 and the exact strict schemas;
   - returned compiler metadata uses the selected model.
3. `OpenAIPageEpisodePlanCompiler.test.ts`
   - target initial and repair calls use Luna/medium;
   - 24,000, strict schema, sanitizer, IDs, and panel contract remain intact.
4. `OpenAIEpisodePlanAuditCompiler.test.ts`
   - target initial and existing retry requests use Terra/medium with identical
     input/schema;
   - 20,000, maximum attempts, refusal behavior, and incomplete/invalid handling
     remain intact.

### Configuration and wiring tests

- `env.test.ts`: missing value resolves to `legacy`; both values parse; every
  other value fails before startup.
- a pure profile-registry test fixes all six model/effort pairs and forbids the
  bare `gpt-5.6` identifier;
- a pure compiler-profile factory used by both API and worker is unit-tested to
  prove each three-adapter set receives one resolved profile. Worker composition
  must give autofill the configured profile and skeleton story planning the
  `legacy` profile. Source-string assertions are not accepted as the primary
  wiring proof;
- telemetry tests accept every allowlisted metric, omit unavailable usage, and
  prove prompts, model output, raw errors, credentials, and email cannot enter the
  event type or serialized log.

### Workflow regression tests

- `PageService.test.ts` keeps beat -> detail pack(s) -> audit -> deterministic
  gate -> atomic apply order, page/panel identity, persistence count, repair bound,
  and progress calls unchanged.
- the existing `EpisodeStoryAutofillCancellation.test.ts` keeps
  completed/failed/cancelled settlement, cancellation checkpoints, trace
  correlation, and safe error handling unchanged;
- `EpisodePageSkeletonWorkerService.test.ts` proves both target-configured and
  legacy-configured worker composition keep `apply_story_plan=true` on the legacy
  episode profile and preserve the existing skeleton creation, nested result
  metadata, settlement, and rollback behavior; `false` remains free of episode
  compiler calls.
- `episodeStoryAutofillDispatch.test.ts` preserves queue dispatch and normalized
  job status/progress behavior;
- `EpisodeStoryAutofillExecutionRepository.test.ts` and
  `EpisodePageSkeletonExecutionRepository.test.ts` preserve terminal-result
  storage for arbitrary historical
  `compiler_model` values and `gpt-5.6-luna`;
- `jobContract.test.ts`, `mobileApiContractGeneration.test.ts`, and
  `apps/mobile/tests/apiContract.test.ts` prove the generated schema bytes do not
  change and both old/new model strings remain valid;
- route safe-error tests prove an unsupported model/parameter or provider failure
  still becomes the existing normalized job/API error without raw provider text or
  request ID exposure;
- existing recovery/refund tests remain green. This free text job adds no credit
  mutation, and the migration must not alter generic generation recovery behavior.

Do not globally replace `gpt-5` strings in Service, Repository, route, or Mobile
fixtures. Most are arbitrary or historical metadata and are useful compatibility
coverage. Only adapter-default and explicit target-profile expectations change.

No frontend feature test is added because no frontend behavior changes. The full
Web/Mobile contract regression and Spec verification gate still run before release.

## 9. Evaluation corpus and measurements

Before implementation testing, freeze a privacy-safe, bilingual corpus manifest
with at least 30 saved episode inputs. Each manifest row contains an opaque case
ID, language, risk tags, sanitized saved-input snapshot, expected invariants, and
one immutable corpus-version hash. Cover:

- Japanese and English;
- short, medium, and maximum-size page sets;
- dialogue-heavy, action-heavy, scene-transition-heavy, and multi-character cases;
- cases that previously triggered repetition, chronology, identifier, output-limit,
  or audit-repair behavior;
- age-appropriate ordinary stories to verify that the model swap does not create
  new false refusals.

Run both profiles the same number of times from the same snapshot. Randomize which
profile runs first inside each pair, and reset the isolated database and storage
before every run so the first output cannot become the second input. Run all 30
cases once per profile, then run two additional repetitions per profile for the ten
highest-risk cases. This produces at least 50 full executions per profile for the
initial p95 report.

Use a dedicated evaluation tenant and environment with no production queue,
customer content, credit, or notification side effects. Sanitized model outputs
needed for blind review may be retained only in access-controlled temporary
evaluation artifacts; they are not committed or emitted to application logs.

Record `EPISODE_PAGE_PLAN_CONTINUITY_V3_ENABLED`,
`EPISODE_PAGE_PLAN_ADAPTIVE_PACKING_ENABLED`, and
`EPISODE_PLAN_INLINE_REPAIR_ENABLED` with every run. Keep their values identical
inside each pair because they change request count, token use, latency, and repair
behavior. Include at least one end-to-end `episode_story_autofill` run through the
real staging queue. The skeleton entry point
is not part of the target paired evaluation; its regression suite proves that
worker wiring remains on `legacy`.

Measure the full job, not isolated model marketing benchmarks:

- queue wait separately from worker execution;
- total and per-stage wall time;
- request count, retry count, audit pass count, and repair count;
- input, cached-input, cache-write, visible-output, and reasoning token usage when
  supplied by the provider;
- actual calculated provider cost;
- structured completion, incomplete, refusal, timeout, 4xx, and 5xx rates;
- deterministic validation, contextual-ID validation, and job completion rates;
- blind human quality scores for chronology, non-repetition, page purpose,
  panel-level visual specificity, dialogue placement, scene/entity correctness,
  and natural Japanese/English.

Implement an evaluator-only harness at
`scripts/evaluateEpisodeOpenAIProfiles.ts`. It constructs the real three adapters
and `PageService`, but supplies a recording `fetchFn` to a separate `OpenAIClient`
for each stage. The wrapper records request start/end, stage/model/effort, HTTP
attempt/outcome, request ID, and a sanitized clone of response `usage`; it never
records request `input` or response output. The harness writes a versioned metrics
JSON matching a Zod schema and uses a price table with source URL and
`observed_at`. This makes retries and cost reproducible without changing production
transport behavior.

Pre-register quality review before seeing profile labels:

- two independent blinded raters score each result from 1 to 5;
- a third blinded rater adjudicates opposite preferences or a difference greater
  than one point;
- the normalized 0-100 aggregate weights chronology 20%, non-repetition 20%,
  page purpose/transitions 15%, panel visual specificity 15%, dialogue placement
  and naturalness 15%, scene/entity correctness 10%, and overall readability 5%;
- case score is the mean of its repetitions, so repeated hard cases do not receive
  triple weight;
- report the paired mean difference and a case-level paired-bootstrap 95%
  confidence interval, plus target wins, ties, and losses;
- exclude a pair only for a pre-declared environment failure affecting comparison
  validity, before profile labels are revealed, and rerun both sides.

For completion/error proportions, report raw counts and paired differences with a
95% confidence interval and a pre-declared five-percentage-point non-inferiority
margin. For p95 latency/cost, report the raw slowest observations as well as the
quantile because 50 executions are still a modest tail sample.

A previously measured single production execution is historical and excludes
queue wait; it is not a valid migration baseline. Capture a fresh multi-job legacy
baseline immediately before the paired evaluation.

## 10. Release gates

All gates are conjunctive: failure of any row keeps `legacy` in production.

| Dimension | Promotion requirement against the paired legacy baseline |
|---|---|
| Cost | Mean actual provider cost per successfully completed full job is at least 20% lower, and p95 cost is not higher. Include uncached reads, cached reads, cache writes, billed reasoning/output tokens, and all fallback/retry/repair calls. |
| Speed | Worker execution p50 is at least 10% lower and p95 is at least 5% lower. Queue wait is reported separately and cannot be used to claim a model improvement. |
| Quality | Blind normalized aggregate is at least 3 points higher, its paired-bootstrap 95% interval does not cross below 0, and target wins exceed losses. No critical chronology, repetition, dialogue, or scene/entity dimension drops by more than 1 normalized point. Deterministic and contextual-ID acceptance do not regress. |
| Robustness | Target completion point estimate is not below legacy and the lower 95% bound is above the -5-point margin. No error class or combined timeout/refusal/malformed/incomplete/exhausted-retry rate is worse; at least one reliability proxy improves. If legacy has zero such errors, target must also have zero and improve retry/repair burden or tail latency. Unsupported model/parameter 4xx, partial persistence, and unknown-ID writes are absolute zero-tolerance failures. |

For small samples, report confidence intervals and raw counts rather than claiming
a percentage improvement from one run. If medium reasoning crowds out visible JSON,
compare Luna `low` only in the evaluator. A lower-effort production profile is a
new versioned decision and must pass the same four gates.

## 11. Cost model and break-even check

Pricing below is the official standard-token price observed on 2026-09-03 and must
be rechecked immediately before rollout:

| Model | Input / 1M | Cached input / 1M | Output / 1M |
|---|---:|---:|---:|
| GPT-5 | $1.25 | $0.125 | $10.00 |
| GPT-5.6 Terra | $2.00 | $0.20 | $12.00 |
| GPT-5.6 Luna | $0.20 | $0.02 | $1.20 |

For an **uncached illustrative break-even only**, let `B`, `D`, and `A` be the
aggregate tokens from all beat, detail, and audit requests, including fallbacks,
retries, and repairs. With uncached input `I` and billed output `O`:

```text
legacy cost = 1.25 * (I_B + I_D + I_A) / 1M
            + 10.0 * (O_B + O_D + O_A) / 1M

target cost = 2.0 * (I_B + I_A) / 1M + 0.2 * I_D / 1M
            + 12.0 * (O_B + O_A) / 1M + 1.2 * O_D / 1M
```

If token counts were identical, target input cost is lower when detail expansion
accounts for more than 41.7% of input tokens, and target output cost is lower when
it accounts for more than 18.5% of output tokens. The detail stage is expected to
clear those thresholds because it expands every page and may run for multiple
packs, but that is a hypothesis. Actual usage, especially reasoning and repair
tokens, decides the release gate.

These equations deliberately exclude cached reads and cache writes and therefore
must not decide promotion. The evaluator applies the current model-specific rate
to every reported usage category, including GPT-5.6 cache-write tokens, using the
pinned price-table timestamp.

## 12. Rollout and rollback runbook

1. Confirm the OpenAI project can access both explicit target IDs and that its RPM,
   TPM, and spend limits cover the measured worst-case pack/retry concurrency.
2. Implement and deploy the profile mechanism with both API and worker explicitly
   set to `legacy`. Record the git SHA, immutable image digest, API/worker task
   definition revisions, environment value, and matching startup log. Verify this
   produces the current request shape and outcomes.
3. Run `scripts/evaluateEpisodeOpenAIProfiles.ts --smoke` in staging for beat,
   detail, and audit in Japanese and English. Every request must complete, pass its
   strict schema and contextual validator, report the expected model/effort, and
   avoid unsupported-model/parameter 4xx. Any failure blocks the rollout.
4. Run the paired corpus and apply every gate in section 10. Record the sanitized
   metrics artifact, raw counts, intervals, model pricing timestamp, deployment
   revision, corpus hash, feature flags, and profile key.
5. Set staging API and worker to `balanced_v1`; run
   `episode_story_autofill` through the real queue, cancellation checkpoints,
   audit, top-level result metadata, and atomic commit. Separately run a skeleton
   regression with `apply_story_plan=true` and verify its nested result still names
   `gpt-5`.
6. During a low-volume production window, roll API and generation-worker task
   definitions to `balanced_v1`. Old and new tasks may overlap during deployment;
   identify every attempt by its job ID, task revision, and profile telemetry. The
   current architecture has no exact per-job traffic split, so do not describe
   this as a percentage canary.
7. The release owner watches the first 20 target-profile terminal jobs **and** at
   least 60 minutes. If 20 jobs have not completed after 60 minutes, observation
   remains open. Use `generation_jobs`, CloudWatch events
   `episode_story_autofill_*` and `episode_page_plan_*`, ECS deployment/task
   health, SQS depth/oldest age/DLQ,
   target-profile telemetry, and the OpenAI project usage/error view.
8. Roll both services back to `legacy` immediately after any unsupported
   model/parameter 4xx, partial/unknown-ID write, model-attributable consecutive
   failure, or p95 worker duration more than 10% above the fresh legacy production
   baseline. Also roll back when the 20-job window breaches any section 10 gate.
9. Let an in-flight worker finish or replace it using the existing safe deployment
   and recovery procedure. A recovered re-execution may use `legacy`; atomic
   persistence prevents a partial result, and the new attempt must carry its own
   task/profile telemetry. Never try to mutate a running process's profile.

A true percentage canary would require isolated routing or a separate queue and is
outside this minimal-flow model migration.

Before merging and again before release, run the repository's actual verification
commands in a CI-equivalent prepared environment. A clean runner must first run
`bun install --frozen-lockfile`, `npm --prefix apps/web ci`, and
`npm --prefix apps/mobile ci`; provision and wait for the disposable PostgreSQL 16
service with the CI test environment; and run `npx playwright install --with-deps
chromium` from `apps/web`. The checked-in CI workflow is the canonical setup.

```text
bun run test
bun test
npm run api:inventory:check
bun run migrate                  # disposable PostgreSQL only during verification
bun run db:check-invariants
bun run build
npm --prefix apps/web run lint
npm --prefix apps/web run build
npm --prefix apps/web run e2e
npm run mobile:contracts:check
npm --prefix apps/mobile run expo:check
npm --prefix apps/mobile run doctor
npm run mobile:typecheck
npm run mobile:lint
npm run mobile:test
npm run mobile:export:android
npm run mobile:export:ios
```

## 13. Implementation sequence

1. Add failing request/profile/env tests.
2. Add the versioned profile registry and environment validation.
3. Extend only the structured Responses helper with optional reasoning effort and
   bounded observational telemetry.
4. Inject the one resolved profile from the shared pure factory into the three
   existing adapters in both composition roots, while constructing the skeleton
   story-plan service with `legacy` adapters.
5. Thread the non-controlling trace context from the autofill job entry point and
   add the evaluator-only instrumented transport and versioned metric schema.
6. Update the three adapter tests and add workflow/contract/telemetry regression
   coverage.
7. Run focused tests, then every named verification command above.
8. Build the fresh legacy baseline, run the target evaluation, and publish the
   measured four-dimension comparison before any production profile flip.

This ordering keeps model selection reversible and makes every observable change
attributable to a named profile rather than to simultaneous prompt, flow, schema,
or UI edits.
