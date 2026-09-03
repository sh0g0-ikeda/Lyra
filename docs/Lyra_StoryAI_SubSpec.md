# Lyra Story AI Sub-Specification

## 1. Scope

Story AI improves an episode draft and prepares story information for page planning.
It must preserve cross-episode continuity and return data that downstream page and
panel compilers can validate. It does not generate final page images directly.

## 2. Current model policy

The current implementation uses OpenAI structured responses. Story collaboration,
page skeleton generation, episode improvement writing, planning, and auditing use
`gpt-5.4-mini`. Model constants are defined in
`src/domain/constants/storyAi.ts`; code is authoritative if model policy changes.

Page-level downstream compilers use their own policies:

- page skeleton story client: `gpt-5.4-mini`
- episode page plan compiler: `gpt-5`
- one-page autofill compiler: `gpt-4o-2024-08-06`

## 3. Input contract

The service receives the selected work and episode context, the current episode
draft, user instructions, known entities, and relevant surrounding chapters or
episodes. Stored user prose is not rewritten merely to canonicalize an entity name.
Entity names and aliases may be canonicalized only in compiler briefs and fallback
inference.

Configured limits are:

- instruction: 2,000 characters
- current draft: 20,000 characters
- selected text: 4,000 characters
- notes: 4,000 characters
- skeleton pages: at most 24
- panels per page: at most 8
- entities per panel: at most 8

## 4. Episode improvement output

The visible writer output must use the UI-selected language. Improvement should
preserve established facts, character identity, causality, and unresolved hooks.
The planner and auditor may use cheaper structured reasoning, but the final result
must satisfy the response schema before it is shown or applied.

Applying an improvement is explicit. Users can review output before replacing the
episode draft. A failed or partial response must not silently overwrite saved text.

## 5. Story-to-pages contract

The story is distributed across the requested page count before it is divided into
panels. Each page must have a purpose and continuity relation. Each panel should
contain a distinct editable beat rather than duplicated generic text:

- situation
- relevant canonical entities
- shot type and camera angle
- composition prompt
- background cue
- dialogue with explicit speaker identity, or narration without a speaker
- sound effect and notes when relevant

The prompt contract for Japanese manga keeps authored panel order as the reading
flow: begin at the upper-right (or rightmost top) panel and follow stored panel
numbers generally right-to-left and downward toward the lower-left. Regular tiers
proceed right-to-left, then top-to-bottom; stored numbering remains authoritative
for asymmetric layouts. Dialogue balloon and caption placement follows that flow
without overriding an authored line position. When Japanese dialogue or narration
is baked into a page image, it uses vertical tategaki: characters top-to-bottom and
columns right-to-left. These requirements preserve the authored wording, speaker or
narration role, position, action, composition, camera, and panel order. Image-model
typography is best effort; deterministic balloon composition, when used, provides
the exact text orientation.

Scenes are optional context. Their absence must not reject skeleton or autofill
generation. When scenes exist, source IDs can be retained as provenance, but raw IDs
are not useful image-model prompt content.

## 6. Quality gates and fallback

Schema validity alone is not sufficient. Successful compiler output is checked for
empty entity assignments, missing visual beats, generic repeated composition,
speaker/dialogue mismatch, invalid page coverage, and frame/panel count mismatch.
Repair is field-level where possible. Deterministic fallback must use only entities
supported by the story context and must not promote unrelated work entities.

Fallback use is recorded in server logs and job metadata, not exposed as technical
provider detail in the normal UI. User-facing errors explain the action the user can
take.

## 7. Security and cost controls

- LLM output is parsed through structured schemas and bounded before persistence.
- Prompts contain only context needed for the current operation; repeated full-work
  text is avoided when a compact continuity brief is sufficient.
- Provider timeouts and retry rules follow the unified specification.
- Text AI operations do not deduct user credits, but rate limits and active-job
  uniqueness still apply to prevent abuse and duplicate cost.

## 8. Required tests

- Japanese and English output-language adherence
- malformed or truncated structured response
- alias-to-canonical entity matching
- thin successful output repaired at field level
- no-scene generation
- entity relevance per panel
- dialogue speaker validation and narration behavior
- requested page/panel count coverage
- duplicate active-job prevention and terminal recovery
