# Mobile legacy job response compatibility

## Purpose and scope

Allow the Mobile client to poll entity reference generation jobs from the currently
deployed legacy API. The change is limited to Mobile response normalization,
presentation typing, and tests. It does not change backend routes, workers, job
persistence, credit accounting, or Web behavior.

## Spec basis

- Unified Spec section 2: character reference generation is a primary flow.
- Unified Spec section 6: long-running entity work is represented by generation
  jobs and the client must follow it to a terminal state.
- Unified Spec section 8: external responses must be validated before use.

## Contract mismatch

The legacy `GET /api/jobs/:id` response contains the job identity, status, cost,
params, result, error message, retry count, and timestamps. The current Mobile
schema additionally requires credit settlement, safe error metadata, progress,
updated time, and action capability fields. The HTTP request therefore succeeds,
but Mobile rejects the response as an invalid API response and renders a load
failure. Generated entity candidates remain present in the legacy `result`.

## Design

Add a Mobile-only compatibility schema that:

1. accepts the current canonical response unchanged;
2. otherwise accepts only the bounded legacy job shape;
3. preserves `params`, `result`, status, cost, and timestamps;
4. supplies display-only progress and safe error defaults;
5. uses `null` for unavailable credit settlement rather than inventing billing
   facts;
6. disables cancel/hide actions that the legacy route does not advertise.

Malformed responses still fail validation. The canonical backend schema and
generated API contract remain unchanged.

## Security

- Authentication and organization scoping are unchanged.
- Raw legacy provider errors are not displayed.
- Candidate tokens in the job result remain opaque.
- No billing or credit state is inferred from the legacy response.

## Test plan and delegation

Write tests first for canonical pass-through, legacy normalization, preservation of
entity candidates, and malformed-response rejection. Run targeted Mobile tests,
typecheck, lint, mojibake, API inventory, and the complete Mobile suite.

Terra performs a read-only independent contract comparison. Sol owns design,
implementation, review, and verification.
