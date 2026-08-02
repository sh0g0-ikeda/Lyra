# StoryAI rate-limit adjustment design (2026-08-02)

## Purpose and scope

- Relax only Lyra's authenticated StoryAI request budget from 20 to 30 requests per 60 seconds.
- Keep the five existing StoryAI routes in the same per-user bucket.
- Do not change image generation, ordinary story editing, billing, authentication, authorization, credits, jobs, persistence contracts, UI, or provider retry behavior.

## Spec basis

- `docs/Lyra_StoryAI_SubSpec.md` section 7 requires rate limits and active-job uniqueness for text AI.
- `docs/Lyra_Unified_Spec_v4.md` sections 6, 8, and 9 require safe generation jobs, bounded external-provider use, and stable API behavior.

## Impacted layers and interface

- Domain: `RATE_LIMIT_RULES.storyAi.maxRequests` only.
- Middleware: no routing or key-format change; the existing `storyAi:<userId>` bucket remains authoritative.
- Database: no schema, migration, row shape, or data migration change. Existing fixed-window rows continue to work with the new maximum.
- Web/Mobile/Worker: no code or contract change.

## Security and abuse controls

- Authentication and ownership checks remain unchanged.
- The limiter remains shared across API instances and scoped per authenticated user.
- The 60-second window, structured 429 response, and `Retry-After` header remain unchanged.
- A limit of 30 stays below ordinary story editing (60 per minute) while leaving image generation at its stricter independent limit (10 per minute).

## Test plan

1. Add an explicit contract test that the StoryAI budget is 30 requests per 60 seconds.
2. Retain route-classification tests proving all five StoryAI routes share the same bucket.
3. Run the focused middleware tests, the full backend test suite, and the backend TypeScript build.

## Delegation

Terra performed read-only mapping of the rate-limit routes, shared-bucket behavior, user-facing 429 path, and safe adjustment options. Sol owns this design, implementation, review, and release decision.
