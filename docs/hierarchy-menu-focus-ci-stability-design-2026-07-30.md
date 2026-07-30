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

## Follow-up: Escape before initial menu focus

### Reproduction and root cause

The work menu can be present in the DOM while its first menu item is still waiting
for the scheduled animation-frame focus. During that interval, keyboard focus
remains on the trigger. Because the menu is rendered through a portal, an Escape
event from the trigger does not bubble through the menu's key handler and the open
menu remains visible.

The Playwright regression makes this state deterministic by opening the menu,
focusing its trigger, and pressing Escape. The pre-fix implementation leaves the
menu mounted and fails the existing closed-menu assertion.

### Minimal repair and acceptance criteria

- Handle Escape on the trigger only when that menu is open.
- Reuse the existing `closeMenu(true)` path so state cleanup and focus restoration
  remain identical to Escape from a menu item.
- Do not add a document-wide keyboard listener or change click, arrow-key, action,
  placement, API, or persistence behavior.
- Confirm the deterministic regression, repeated focused Playwright runs, Web
  lint/build, the full Playwright suite, and the complete CI gate.
