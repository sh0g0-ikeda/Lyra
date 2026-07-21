# Desktop header navigation hierarchy

## Purpose and scope

The desktop header separates production navigation from workspace and account
controls. Story, Characters, and Pages remain equal primary destinations.
Workspace selection stays in the left sidebar, while workspace settings,
language, and logout move into one account menu.

This change is limited to the web presentation layer. It does not change API
requests, authentication, authorization, organization selection, billing,
generation jobs, persistence, or the mobile bottom navigation.

## Specification basis

- Unified Spec section 2: preserve the existing authenticated manga-production
  flows.
- Unified Spec section 4: preserve role-based workspace access and account
  actions.
- Unified Spec section 7: preserve the active workspace as the credit scope.
- Unified Spec section 10: verify the browser contract, web lint, and web build.

## Interface and behavior

- The desktop primary navigation contains exactly Story, Characters, and Pages
  when the active role can view works.
- The existing sidebar workspace selector remains the only scope switcher.
- The account menu shows the signed-in email and exposes Workspace settings,
  Language, and Logout.
- Workspace settings reuses the existing `account` tab and account panel.
- Language reuses the existing stored UI-language handler.
- Logout reuses the existing Cognito logout callback.
- Billing-only organization roles continue to open the existing account panel
  and do not gain access to production tabs.
- The mobile bottom navigation and mobile account panel remain unchanged.

## Security and failure boundaries

The change introduces no new data access or authorization path. Existing
workspace membership checks remain authoritative. The account menu only invokes
already-authorized client actions and does not expose tokens or provider errors.

## Test plan

1. Add a Playwright contract that verifies the desktop hierarchy and menu.
2. Keep the existing mobile hierarchy test green.
3. Run web lint and production build.
4. Run the full Playwright suite and repository release gates before deployment.

## Orchestration

`multi_agent_v1` is unavailable in this environment. The Terra packet is run as
a local checklist: inspect desktop/mobile breakpoints, verify that no API calls
or workspace state transitions change, and review the final diff for web-only
scope.
