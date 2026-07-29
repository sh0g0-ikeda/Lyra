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

The relevant deployed history contains three job response generations:

1. the hardened June response contains the job identity, status, cost, params,
   result, error message, retry count, and timestamps;
2. the cancellation branch adds `cancel_requested_at`, `cancelled_at`, and
   `commit_started_at`, and uses `cancelled` for the terminal status;
3. the current response adds credit settlement, safe error metadata, progress,
   updated time, and action capability fields, and uses `canceled`.

The current Mobile schema requires every current field. The first compatibility
schema accepted exactly the hardened June fields, so the valid cancellation-branch
response was still rejected as an invalid API response. A failed initial lookup
also stopped automatic polling because no job status had been obtained yet.

Older pre-production responses that exposed user IDs, storage keys, queue message
IDs, or provider request IDs remain rejected. Those fields are not required for
the supported Mobile flow.

## Design

Add a Mobile-only compatibility schema that:

1. accepts the current canonical response unchanged;
2. otherwise accepts the bounded June core with only the three known cancellation
   fields as optional nullable values;
3. normalizes `cancelled` to the Mobile canonical `canceled`;
4. supplies display-only defaults for fields absent from that branch;
5. uses `null` for unavailable credit settlement rather than inventing billing
   facts;
6. disables cancel/hide actions that the legacy route does not advertise;
7. continues polling after a lookup error so a transient legacy lookup failure
   does not strand the accepted generation job.

Malformed fields and unknown fields still fail validation. The canonical backend
schema and generated API contract remain unchanged.

## Security

- Authentication and organization scoping are unchanged.
- Raw legacy provider errors are not displayed.
- Candidate tokens in the job result remain opaque.
- No billing or credit state is inferred from the legacy response.

## Test plan and delegation

Write tests first for canonical pass-through, the June legacy shape, cancellation
branch normalization, malformed-field rejection, and polling recovery after an
initial error. Run targeted Mobile tests, typecheck, lint, mojibake, API inventory,
and the complete Mobile suite.

Terra performs a read-only independent contract comparison. Sol owns design,
implementation, review, and verification.
