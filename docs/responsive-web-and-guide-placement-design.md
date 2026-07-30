# Responsive Web And Guide Placement Design

## Purpose and scope

- On smartphone Web, let users collapse the work hierarchy.
- On smartphone Web, move workspace switching out of the sidebar and make Account
  the visible place for changing workspace.
- On smartphone Web, place episode Save immediately before Story AI and place New
  character beside Reset draft and Delete in the character editor.
- Keep the existing desktop placements unless responsive copy must explain the
  desktop/mobile difference.
- Update Web and Mobile guide copy so every statement about control location matches
  the corresponding surface.
- Do not change APIs, persistence, generation jobs, billing, or editor payloads.

## Specification basis

- Unified Spec section 2: preserve the story, character, and page production flow.
- Unified Spec section 3: keep this change inside the Web and Mobile clients.
- Unified Spec sections 4 and 5: workspace selection continues to use the existing
  authenticated organization scope and stored selection.
- Unified Spec section 10: verify responsive Web with Playwright and verify both
  client builds/tests before release.

## Interfaces and affected layers

- Web: responsive presentation state, existing workspace selection handler, existing
  episode save handler, existing new-character handler, and tutorial copy.
- Mobile: guide translation copy only.
- Route, Service, Repository, Domain, Infrastructure, Worker, Ops: unchanged.
- Inputs/outputs: existing button handlers and API payloads remain unchanged. The
  work-list disclosure state is local presentation state and is not persisted.

## Security

- Authentication, authorization, organization membership checks, and tenant IDs are
  unchanged.
- Hiding the smartphone sidebar workspace selector does not bypass or replace the
  Account selector; both use the existing scoped selection state.
- No secrets, user content, storage paths, credit logic, or generated output are
  introduced.

## Test plan

1. Add a Playwright contract that fails until smartphone Web exposes the work-list
   disclosure, hides the sidebar workspace selector, shows the Account selector,
   and places Save/New character at their requested locations.
2. Assert desktop keeps its sidebar workspace selector and existing action placement.
3. Add a Mobile guide-copy contract that fails until Story, Character, and Page
   location guidance matches the native screens.
4. Run focused tests, Web lint/build/E2E, Mobile tests/typecheck, then repository
   release gates appropriate to the changed client surfaces.

## Delegation

No delegation. The repository requires Sol/Terra orchestration for this scope, but
the active collaboration mode disallows spawning sub-agents unless the user asks.
The Web and Mobile task packets are therefore executed locally as separate,
reviewable branches.
