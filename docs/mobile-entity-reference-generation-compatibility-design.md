# Mobile entity reference generation compatibility

## Purpose and scope

Restore character saves and full-body reference preview generation when the
installed Mobile client talks to the currently deployed legacy API. The change is
limited to the Mobile API client and its tests. It does not change backend routes,
generation jobs, credits, persistence, or Web behavior.

## Spec basis

- Unified Spec section 2: creating and confirming character reference images is a
  primary product flow.
- Unified Spec section 6: entity generation uses the current saved inputs and the
  existing generation-job pipeline.
- Unified Spec section 8: request bodies remain bounded by the server contract.

## Contract mismatch

The current Mobile entity update payload always includes `expected_updated_at`.
The deployed legacy API uses a strict update schema that predates that field, so it
returns `VALIDATION_ERROR` with an unrecognized-key message. Full-body preview
generation first auto-saves the entity, so this update failure prevents the
generation request from being sent.

## Design

`LyraMobileApiClient.updateEntity` first sends the current optimistic-concurrency
payload. It retries once without `expected_updated_at` only when a 422
`VALIDATION_ERROR` explicitly says that `expected_updated_at` is an unrecognized
key. All other validation failures are returned unchanged.

The fallback temporarily loses optimistic-concurrency protection only against the
legacy API, which cannot enforce that contract. Once the backend accepts the
current payload, the normal single-request path remains in use.

Imported-image candidate tokens already match the deployed generation contract and
remain unchanged. The Mobile client never downgrades them to raw storage keys.

## Security

- Authentication and organization query scoping are unchanged.
- No raw S3 key is recovered or exposed by the Mobile client.
- The retry is restricted to one exact legacy-schema error and cannot retry
  arbitrary 400/422 responses.
- Credit deduction and generation-job behavior remain server-owned.

## Test plan and delegation

Add Mobile API tests first for:

1. exact legacy rejection retries once without `expected_updated_at`;
2. unrelated validation errors are not retried;
3. current API success performs one request.

Run the targeted Vitest file, Mobile TypeScript checks, lint, and the Mobile test
suite. Terra performs read-only contract and production-version investigations;
Sol owns the design, implementation, integration review, and verification.
