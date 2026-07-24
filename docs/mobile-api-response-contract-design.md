# Mobile API Response Contract Design

## Purpose and scope

Complete `MOB-API-001` and Audit A by making every production Backend JSON
response consumed by Mobile validate against the canonical schemas in
`packages/api-contract`. Binary downloads, `204 No Content`, health, admin,
local-only, and provider webhook routes remain outside this JSON response
boundary.

The Mobile generated schema/type/payload files remain generated artifacts and
must not be edited directly.

## Specification basis

- `docs/mobile_completion_gap_spec.md` sections `6.2 MOB-API-001`, `7`, and
  `14 Audit A`
- `docs/Lyra_Unified_Spec_v4.md` API, Mobile client, tenancy, and verification
  contracts
- `AGENTS.md` sections 3, 4, and 8

## Affected layers and interfaces

- Shared contract: canonical Zod response schemas, including complete page
  skeleton and StoryAI SSE envelopes.
- Route: validate each Mobile-facing success JSON payload immediately before
  `c.json`.
- Mobile: regenerate canonical copies and retain runtime validation.
- Tests: contract-boundary behavior, route success fixtures, generated drift,
  and a method-to-route inventory.

## Wire compatibility

Some Mobile view schemas use Zod transforms or defaults. The Backend boundary
therefore validates a raw payload with `safeParse` but returns the original
payload object. It never serializes `result.data`. This preserves wrapper
objects and omission of legacy `next_cursor` while still failing closed on
contract drift.

## Security

- Validation failures throw one stable configuration error and never include
  payload values, provider errors, credentials, or stack details in the client
  response.
- Existing route authentication, ownership, organization membership, and role
  checks remain unchanged.
- No request body or query value is trusted as a schema selector.
- Binary exports and `204` responses are not coerced into JSON.

## Test plan

1. Prove transformed/defaulted schemas validate without changing the wire
   object and invalid payloads fail without leaking values.
2. Add missing canonical response fields/envelopes and regenerate Mobile.
3. Wrap route groups A, B, and C, then run their focused auth/tenancy/contract
   tests.
4. Wrap jobs after processing-cancellation integration and parse its route
   responses with the canonical job schemas.
5. Run contract drift, Backend build/tests, Mobile API tests, and Audit A
   inventory.

## Delegation

Sol owns the validation helper, missing canonical schemas, jobs integration,
and final audit. Terra may implement disjoint route groups after the helper
contract is green:

- A: account, me, billing, mobile purchases, push tokens, compositions,
  reference uploads.
- B: organizations.
- C: story, entities, scenes, pages, panels, assignments, frames, balloons,
  and exports.
