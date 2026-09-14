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

## 2026-09-14: bind template geometry to every panel instruction

The investigated four-panel production result placed P1/P3 on the left despite
the correct right-first template and a byte-identical reconstructed prompt. The
compiler and optional planner were not used. Text already specified manga/RTL;
the missing control is an easily interpretable binding from each story panel to
its physical frame. No user story or image is added as a committed test fixture.

Implementation starts in an isolated worktree from `352b257` (application source
`af97d5b`, API 132 / Worker 75), preserving the dirty root and existing release
branches. Scope is the prompt/input-image pipeline, not saved layout editing,
client contracts, models, credits, retries, image QA or automatic regeneration.

- A pure shared layout resolver uses the existing 19-template catalog as the
  authoritative geometry and preserves its reading numbers, including spanning,
  angled and column-first templates. Custom/AI layouts retain their saved map.
  It understands saved camelCase and API snake_case frame fields; incomplete or
  unknown layouts must not invent a numbered guide or a different template.
- The same resolved map supplies a plain-language template description, a physical
  placement instruction beside each Panel N, explicit top-left coordinate origin,
  and a compact final frame/content binding. Character left/right positions remain
  local to their frame and must not determine where the frame sits on the page.
- Carry the deterministic final layout instruction independently of LLM prose and
  append it after any optional internal plan at the image-provider boundary.
  Preserve all existing authored dialogue, speakers, identity, action, camera and
  style locks; do not shorten unrelated prompt content to achieve this change.
- Attach a deterministic numbered border guide for known templates and valid
  saved custom/AI maps. Character references remain first in unchanged order;
  the layout guide is last, explicitly identified in the prompt. Numbers are
  reference labels and must not be drawn in the finished artwork. Keep existing
  character-reference count, billing and input-byte limits.
- Pass the resolved guide frames from prompt construction into reference-image
  preparation so a second layout read cannot select a different template midway
  through one generation. This is an internal interface, not an API/DB change.
- First demonstrate failures for template-guide attachment, frame placement next
  to panel content, and final-suffix retention with/without planner text. Cover all
  template geometries, custom/camelCase compatibility, missing frames, reference
  ordering, and preservation of dialogue/identity. Render and inspect guide PNGs.
  Then run targeted/full backend tests, build/contracts, and normal release CI.

Parent owns shared layout resolution, prompt/Worker/provider wiring, tests and
integration. Terra owns only the numbered guide renderer and its direct tests;
Sol reviews design and the integrated change. SQL, authorization, saved user data,
Mobile/Web binaries and Worker scaling settings are outside the write scope.
Prompt/guide adherence remains probabilistic; this change must not be reported as
a demonstrated zero-failure rate without actual image-generation evaluation.

Review refinements:

- Adding/deleting panels can leave a stale template ID. A count mismatch uses
  generic RTL with the actual panel count, without inventing a guide or throwing
  a new generation error. Both resolved and fallback paths append the final lock
  in the Worker, after the optional plan; the provider adapter sends it verbatim.
- Very narrow custom frames retain borders and the textual coordinate mapping
  if a label cannot fit fully inside the polygon. An annotation must never spill
  into a neighboring frame. All 19 catalog templates must fit every label.
- Completion metadata adds only `render_prompt_sha256`, `render_prompt_bytes`
  and `page_layout_control_version` in the existing JSONB diagnostics. Final
  prompt text is not persisted there. No SQL or schema changes are required.
- Production scope is Worker only. Preserve API 132, Worker runtime settings,
  schedule/autoscaler settings, native clients and stored artwork. Deploy only
  after exact-source CI and an isolated actual-image probe (mock image provider
  and read-only DB invariants); rollback is the saved Worker 75 task definition.
