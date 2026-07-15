# Episode audit structured-response recovery

## Purpose and scope

The production `episode_story_autofill` flow failed after the complete episode draft had
been compiled but before persistence. Two consecutive attempts showed distinct failures
from the same final audit boundary:

- a truncated or otherwise malformed structured JSON response;
- a non-UUID value in `panel_repairs[].page_id`.

This change is limited to the final episode audit compiler and the shared structured
response parser. It does not change story distribution, chunk compilation, repair
application, persistence, credits, job ownership, or organization tenancy.

## Specification basis

- Unified Spec section 6: LLM output is validated and quality-gated before persistence.
- Unified Spec section 8: external API calls are bounded and retries are classified.
- Unified Spec section 9: generation jobs remain idempotent and fail before commit when
  a compiler result cannot be trusted.

## Design

1. The audit input carries the exact existing page IDs. The strict JSON Schema uses
   those IDs as enums for issue references and page/panel repairs. The model cannot
   invent an identifier that the audit flow could later apply to another page.
2. The structured response parser inspects Responses API completion state before JSON
   parsing. `max_output_tokens` incompleteness and completed-but-malformed output are
   classified as recoverable. Refusals and other incomplete states remain terminal.
3. The episode audit compiler may make one recovery request only for a recoverable,
   fully received structured-response failure. It never retries timeouts, HTTP failures,
   refusals, content filtering, or downstream repair validation.
   This limit means at most two structured audit attempts. The shared HTTP client may
   still retry transient transport, `429`, or `5xx` failures within each attempt under
   its existing bounded policy; this change does not add or widen those transport retries.
4. The audit output budget is raised from 12,000 to 20,000 tokens. This is a ceiling,
   not a reserved charge, and prevents valid 10-page audits from being cut off while
   retaining the schema's item and text limits.
5. Both attempts use the complete episode brief and the same allowed page IDs. No
   page-level fallback or unaudited acceptance is introduced.
6. Before the recovery request, the service progress callback runs again. The worker's
   checkpoint wrapper therefore honors a user cancellation instead of starting a second
   provider request after cancellation was requested.

## Security and failure behavior

- Raw provider output and story text are never included in errors or logs.
- Only safe metadata (failure category, attempt number, request ID) may be logged.
- Schema validation, known page/panel validation, deterministic continuity checks, and
  the transaction boundary remain mandatory.
- If both attempts fail, no page or panel change is persisted.

## Test plan

- Structured response: incomplete token limit, refusal, malformed JSON, and payload
  validation are classified without exposing response content.
- Audit compiler: allowed page IDs are embedded in the strict schema; malformed output
  succeeds on one retry; invalid page IDs retry once; refusal does not retry.
- Page service: every audit call receives the page IDs from the current episode context.
- Run targeted tests first, then the full backend tests/build, DB invariants, web
  lint/build, and Playwright smoke before release.
