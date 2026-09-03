# Japanese manga reading flow prompt design

## Purpose and scope

Generated manga pages should use the Japanese reading convention consistently:

- the first panel is the upper-right or rightmost top entry;
- panels and their story beats follow stored panel numbers generally right-to-left and downward toward the lower-left;
- dialogue balloons and captions follow the same reader-eye progression;
- Japanese dialogue and narration baked into the page image use vertical tategaki: glyphs run top-to-bottom and columns advance right-to-left.

This change is limited to the existing StoryAI and page-image prompt pipeline. It does not add a new setting, API field, database column, layout template, renderer, or UI control. Existing authored dialogue, panel count/order, character identity, action, composition, and camera direction remain authoritative.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` sections 2, 3, 6, and 8: editable manga-page planning, infrastructure-owned provider prompts, validated generation output, and current-input generation.
- `docs/Lyra_StoryAI_SubSpec.md`: skeleton and autofill output must preserve existing page/panel structure and remain editable before image generation.

The fixed panel templates already store Japanese reading order. Regular tiers run right-to-left and then downward, while asymmetric templates can use a deliberate column-first path. The missing contract is an explicit binding between numbered panels, physical frame geometry, conversation placement, and Japanese text orientation in every prompt path that reaches the page image model. Stored coordinates and panel numbers remain authoritative so existing custom layouts and asymmetric templates are not silently mirrored or reordered.

## Affected layers and interfaces

- Service: `PromptBuilder` adds deterministic layout geometry and Japanese manga text/eye-flow constraints to both the direct draft prompt and compiler brief.
- Infrastructure: the page prompt compiler, optional page-generation planner, whole-episode detail compiler, and legacy single-page autofill compiler preserve the same convention.
- Domain constants: prompt versions change where version metadata already exists.
- Spec/tests: contract wording and prompt assertions are updated.

Inputs, structured-output schemas, persisted page/panel/dialogue records, jobs, credits, image-provider endpoints, and user-facing errors do not change.
The page prompt version advances from v2 to v4 because v3 is already allocated by
the open image-safety prompt change; this avoids two different contracts sharing one
version if the branches are integrated together.
To keep the existing compiler-brief size ceiling after adding the frame map, only the
compiler copy of unusually long style prose is summarized more tightly. Every style
anchor category, the named style, and user notes remain represented; the direct
image-renderer draft keeps the existing style limits.

## Security and reliability

- User-authored story and dialogue remain data, not instructions; existing prompt-injection guidance and schema validation remain unchanged.
- The change does not touch authentication, authorization, tenancy, SQL, secrets, uploads, billing, retries, or transactions.
- Template frame coordinates are taken only from trusted domain constants. Custom/AI layout coordinates continue to use the existing validated normalization path.
- Prompt instructions must not move, omit, paraphrase, or reassign authored dialogue, nor override its saved position or alter authored action/composition/camera merely to make room for text.

Image-model typography remains best effort. Deterministic overlay balloons already use vertical writing for non-SFX text, but exposing that editor/preview path is outside this task.

## Test-first plan

1. Add prompt-contract assertions for template frame mapping, upper-right entry, right-to-left/downward flow, dialogue ordering, and vertical Japanese writing.
2. Confirm those assertions fail before implementation.
3. Add the minimum prompt changes and bump affected prompt versions.
4. Run the six targeted test files, backend build, full Vitest suite, and diff checks. Web/mobile builds are not required because no client code or API contract changes.

## Terra delegation

Read-only investigation was delegated for (1) layout/template flow, (2) dialogue typography and renderer flow, and (3) an independent compiler-scope audit. Bounded source and documentation edits were then delegated with exclusive file ownership. Sol reviewed and integrated every change, added the shared `PromptBuilder` behavior and regression coverage, and ran the final validation. The investigations confirmed that templates and deterministic balloon SVG rendering are already Japanese-oriented, while normal locked page generation sends `PromptBuilder.draftPrompt` directly to the image renderer; therefore `PromptBuilder` is the mandatory enforcement point.
