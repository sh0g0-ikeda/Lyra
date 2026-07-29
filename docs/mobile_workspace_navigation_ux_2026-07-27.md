# Mobile workspace navigation and editor UX design

## Purpose and scope

- Place one compact work/chapter/episode navigator at the top of Story, Characters, and Pages.
- Remove redundant work/chapter title editors and the old current-episode picker from those screens.
- Reorder Story AI before Scenes, keep Episode open by default, and keep Scenes collapsed with continuity guidance visible.
- Move character image import immediately after entity type selection.
- Keep the page style reference collapsed by default.
- Separate page selection from image enlargement in the horizontal page strip.
- Improve shared mobile input and selection control contrast.

This change does not alter backend routes, request payloads, persistence contracts, billing, or generation jobs.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md`: Architecture / Mobile app boundaries.
- `docs/Lyra_Unified_Spec_v4.md`: Product workflow for work, chapter, episode, character, and page editing.
- `docs/Lyra_Unified_Spec_v4.md`: Input safety and bounded mobile editor fields.
- `docs/Lyra_Unified_Spec_v4.md`: Verification gate.

## Affected layers and interfaces

- Mobile only: shared components, Story screen, Characters screen, Pages screen, localization, and tests.
- The hierarchy navigator reads the existing work/chapter/episode queries and writes the existing persisted workspace selection.
- Page thumbnail selection continues to update `pageId`; image preview receives existing authenticated image candidates and does not change selection.
- Character image import continues to use the existing direct upload mutation and payload.

## Security

- Authentication, organization scope, ownership checks, signed image delivery, upload validation, and permissions remain enforced by existing API and mobile clients.
- No secret, raw provider error, or new user-controlled storage path is introduced.
- Existing dirty-editor checks remain active when changing workspace hierarchy or selected pages.

## Test strategy

1. Add failing component tests for the compact hierarchy launcher and separate page preview action.
2. Add screen contract tests for order, removal of redundant pickers, default collapse state, and required Japanese copy.
3. Add shared control tests for visible borders/focus behavior where practical.
4. Run the nearest mobile Vitest tests, then mobile lint/typecheck and the full mobile suite.
5. Review the final diff, push the branch, and verify CI and an Android development build.

## Sol/Terra delegation

Terra performs a read-only implementation map and risk review. Sol owns design, all integrated edits, security decisions, final review, verification, commit, push, and release checks.
