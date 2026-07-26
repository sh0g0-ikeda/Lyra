# Mobile page query recovery design

## Purpose and scope

Fix the mobile Pages screen when a usable workspace selection is accompanied by
stale `429` or `404` query errors. The change is limited to the mobile client.
Backend routes, services, repositories, database state, and rate-limit rules are
not changed.

The client will:

- show an error only when the current query has no usable data;
- retry only the failed workspace query instead of all hierarchy queries;
- avoid automatic React Query retries for `429` responses;
- reject a persisted page selection that does not belong to the active episode;
- clear a missing persisted page without treating optional supporting data as a
  missing page;
- start page-dependent supporting queries only after the page list has resolved.

## Spec basis

`docs/Lyra_Unified_Spec_v4.md` defines the mobile client as an API consumer,
requires personal and organization ownership scopes to remain separate, and
requires the API to stay responsive while work is performed. The mobile client
must therefore preserve `organization_id`, follow the backend resource
hierarchy, and avoid avoidable request bursts.

## Affected layers and interfaces

- Mobile only: React Query policy, workspace selection hook, and Pages screen.
- Inputs: persisted work, chapter, episode, page, and organization IDs.
- Outputs: current selection, visible recovery notice, and bounded refetches.
- External API: existing read endpoints only. Paths and payloads do not change.
- Persistence: an invalid persisted `pageId` may be cleared through the existing
  `updateSelection` API with the dirty check explicitly skipped.

## Security

- Authentication headers and tokens remain unchanged.
- Organization scope remains part of every scoped query key and API request.
- A page returned by the detail endpoint is accepted only when its
  `episode_id` matches the active episode.
- Error handling does not expose raw paths, IDs, request bodies, tokens, or
  provider messages.

## Test plan

Add failing tests first for:

1. suppressing a background query error when usable data exists;
2. excluding `429` from automatic React Query retries;
3. retrying only the failed workspace hierarchy query;
4. rejecting a page detail from a different episode;
5. suppressing optional supporting `404` errors while retaining essential
   unresolved errors.

Then run the focused Vitest files, the full mobile test suite, typecheck, lint,
contract and mojibake checks, Android/iOS exports, and the repository gates.

## Terra delegation

Terra performed a read-only sidecar investigation of production route presence,
CloudWatch location, and likely endpoint candidates. Sol owns the design,
implementation, integration, and final verification. AWS credentials are
currently unavailable locally, so no production operation is performed.
