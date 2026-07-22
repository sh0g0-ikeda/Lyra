# UI guidance and editor boundaries design

## Purpose and scope

- Add concise beginner guidance to character reference import and free-description inputs.
- Remove the duplicated current-episode selector from the Characters and Pages tabs. The sidebar work tree remains the single selection path.
- Move the existing page art-direction settings to the top of the Pages workflow and clarify their labels and purpose.
- Explain that detailed frame geometry is optional advanced control.
- Make panel-character assignments and dialogue lines visually distinct without changing their stored values.
- Do not change API payloads, database fields, generation prompts, credit behavior, or job behavior.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: preserve the story, entity-reference, panel-editing, and page-generation product flow.
- Section 3: keep this change in the `apps/web` presentation layer; service and persistence boundaries remain unchanged.
- Section 10: run frontend lint/build, authenticated Playwright smoke coverage, and the repository release gates before deployment.

## Affected layer and contracts

- Layer: Web only (`apps/web/src/App.tsx`, `apps/web/src/index.css`, and Playwright coverage).
- Inputs and outputs: unchanged. Existing React state, update handlers, `toPageSettingsPayload`, panel assignment payloads, and dialogue payloads remain authoritative.
- Persistence: unchanged. Art-direction fields continue using `style_reference_title` and `style_reference_notes`.
- External APIs and jobs: unchanged.
- Errors: unchanged.

## Implementation design

1. Add translated helper strings and render them as muted supporting text adjacent to the relevant inputs.
2. Delete only the two duplicated selector sections. Do not remove selection state or sidebar hierarchy behavior.
3. Render the existing art-direction section first in the Pages stack and give it clearer labels and supporting copy. Retain the same save action and draft fields.
4. Add an optional-use explanation inside the advanced frame-geometry disclosure.
5. Add purpose-specific wrappers and headings to character assignments and dialogue lines. Use restrained accent borders and backgrounds rather than adding nested decorative cards.
6. Keep responsive layouts bounded so labels and speaker names wrap without horizontal overflow.

## Security and reliability

- No authentication, authorization, tenancy, upload validation, billing, or secret handling changes.
- No raw IDs or provider errors are newly exposed.
- Upload accept rules and existing API calls remain intact.
- The UI reordering must not mutate or reset draft state.

## Test plan

- Extend authenticated Playwright coverage first and confirm it fails before implementation.
- Verify both English and Japanese helper text.
- Verify the duplicated selector is absent from Characters and Pages.
- Verify art direction precedes the page list and still exposes both saved fields.
- Verify optional frame-geometry guidance and distinct character/dialogue editor boundaries.
- Run web lint/build, full Playwright, root tests/build, Bun tests, invariant checks, diff checks, and a mojibake scan.

## Sol/Terra execution

`multi_agent_v1` is not available in this session. The bounded Terra packet is therefore executed as this local checklist: independently inspect selector duplication, page-section ordering, and editor-boundary selectors before Sol integrates and reviews the change.

## Verification record

- The new Playwright scenario failed first on the missing reference-import guidance, then passed after implementation.
- Visual review covered the art-direction section, character-assignment boundary, dialogue speaker boundary, and a 390 px mobile viewport.
- An accessibility regression found by the full E2E suite was fixed by preserving the concise textarea accessible name while keeping visible help text.
- Final local gates: web lint/build, 11 Playwright tests, 1,210 Bun tests (1 skipped), root TypeScript build, and 41 database invariants all passed.
