# Story new-work sidebar design

## Purpose and scope

- Move the new-work composer from the story workspace into the left Works sidebar.
- Keep the composer compact and outside the hierarchy scroll area so it remains reachable on desktop and mobile.
- Hide Genre from new-work and work-overview forms without changing the work API, `WorkDraft`, or database contract.
- Do not change chapter/episode hierarchy behavior, generation pipelines, billing, or backend routes.

## Spec basis

`docs/Lyra_Unified_Spec_v4.md` defines the authenticated work/chapter/episode hierarchy and requires every request to remain scoped to personal ownership or active organization membership. The existing `canCreateActiveOrganizationWorks` UI guard and `organizationId` API argument remain authoritative.

## Interface and data handling

- The sidebar composer reuses `newWorkDraft`, `runAction`, `api.createWork`, selection updates, and scoped query invalidation.
- New work creation continues to send `genre: null` through the existing empty draft.
- Existing work drafts retain their loaded `genre` value. Saving a work therefore preserves legacy genre data even though no Genre control is rendered.
- Users without `create_work` permission see the existing permission guidance in the sidebar and cannot submit the form.

## Responsive behavior

- The composer is rendered before `.sidebar-work-list`; only the hierarchy list scrolls on narrow screens.
- The disclosure starts open for discoverability and can be collapsed to recover vertical space.
- Controls use the sidebar width and must not create horizontal overflow at 390 px.

## Verification

- Playwright verifies sidebar placement, hidden Genre controls, create payload compatibility, legacy genre preservation, and mobile overflow.
- Web lint/build and repository tests remain unchanged because no backend contract is modified.
