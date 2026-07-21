# Story hierarchy action menu design

## Purpose and scope

Replace the inline action icon groups in the work, chapter, and episode tree with
one compact overflow menu per row. The title remains the primary content and gets
the available horizontal space. Existing rename, create, move, and delete behavior
is reused without changing API, persistence, ordering, tenancy, billing, or job
contracts.

Out of scope:

- Adding work deletion or work reordering
- Changing chapter or episode move semantics
- Changing confirmation text or server endpoints
- Changing the mobile navigation structure

## Specification basis

- Unified Spec section 2: work, chapter, and episode creation is a primary flow.
- Unified Spec section 4: existing personal and organization authorization remains
  enforced by the current API calls.
- Unified Spec section 10: frontend lint/build and authenticated Playwright smoke
  remain release gates.

## Affected layers and interfaces

- Web only: `StoryHierarchyTree.tsx`, hierarchy CSS, and Playwright coverage.
- Inputs and outputs are unchanged. The menu invokes the same callbacks and API
  client methods currently used by the inline buttons.
- Each row exposes a named menu trigger. The popup contains only actions supported
  by that node type, preserves disabled move boundaries, and closes after selection.

## Interaction and accessibility contract

- One always-visible three-dot trigger is reserved at the right edge of each row.
- The popup escapes the scroll container, stays inside the viewport, and can open
  above the trigger near the bottom edge.
- Escape and outside pointer interaction close it. Scrolling and viewport resizing
  reposition it so focus-driven scrolling cannot immediately dismiss the menu.
- Opening focuses the first enabled item; arrow keys, Home, and End move focus.
- Closing with Escape restores focus to the trigger.
- Destructive actions retain the existing confirmation dialog.

## Security and regression controls

- No raw IDs, provider errors, or additional data are exposed.
- Organization context continues to be passed through the existing callbacks.
- Busy state disables menu operations just as it disabled the former icon buttons.
- Menu rendering never bypasses existing authorization or mutation workflows.

## Test plan

1. Add a mobile Playwright contract that fails until compact menu triggers exist.
2. Verify actions are hidden until the matching menu opens.
3. Verify disabled movement boundaries, Escape focus restoration, and outside close.
4. Verify title and trigger boxes do not overlap at 390px width.
5. Run web lint/build, targeted Playwright, full repository tests/build, and release
   smoke checks before deployment.

The local deployment invariant check may still report historical
`credit_ledger.job_refund_over_consumed` rows. That pre-existing data issue is
tracked separately because this web-only change neither reads nor writes the
credit ledger.

## Sol/Terra split

Sol owns design, implementation, integration, and release. Terra performs a
read-only accessibility and clipping-risk review; its findings are reviewed before
the implementation is finalized.
