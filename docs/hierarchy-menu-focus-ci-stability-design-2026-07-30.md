# Hierarchy Menu Focus CI Stability

## Purpose and scope

- Make the existing story-hierarchy keyboard menu keep the user's selected item
  focused when an unrelated parent render occurs while the menu is open.
- Remove the main-branch Playwright flake that blocks the responsive Web release.
- Do not change hierarchy actions, responsive placements, API calls, persistence,
  jobs, billing, or production configuration.

## Specification basis

- Unified Spec section 2: preserve work, chapter, and episode navigation.
- Unified Spec section 3: keep the repair inside the Web client.
- Unified Spec section 10: the authenticated Playwright smoke must pass before
  production deployment.

## Root cause and interface

`HierarchyActionMenu` recomputes its enabled-item array and menu placement callback
from a newly created `actions` prop on every parent render. Its layout effect treats
that render like a fresh menu open and schedules focus back to the first enabled
item. If a parent query or responsive update lands immediately after an `End` key,
the requested last-item focus is overwritten. CI exposed this race while local runs
usually completed before the unrelated render.

Keep the current action and keyboard interfaces. Stabilize the placement callback
with primitive layout inputs and read the latest enabled indexes through a ref so
the initial-focus effect runs for an actual open/layout change, not an equivalent
array identity change.

## Security and data impact

- Authentication, authorization, organization scoping, payloads, and storage are
  unchanged.
- The change affects DOM focus only and introduces no new user input or external
  request.

## Test plan

1. Extend the existing mobile hierarchy Playwright test to cause a parent responsive
   render after `End`; confirm the current implementation loses last-item focus.
2. Implement stable focus dependencies and confirm the focused item is preserved.
3. Run the focused test repeatedly, then Web lint/build/full Playwright.
4. Require the complete main CI gate before building the production image.

## Delegation

No delegation. Active collaboration policy disallows sub-agents unless explicitly
requested. The bounded Web focus repair and release validation are executed locally.
