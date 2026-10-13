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
- skeleton pages: at most 32
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

Scenes are optional context. Their absence must not reject skeleton or autofill
generation. When scenes exist, source IDs can be retained as provenance, but raw IDs
are not useful image-model prompt content.

## 6. Quality gates and fallback

Schema validity alone is not sufficient. Successful compiler output is checked for
incorrectly empty assignments where the source requires a visible character,
missing source facts or continuing actions, missing visual beats, generic repeated composition,
speaker/dialogue mismatch, invalid page coverage, and frame/panel count mismatch.
Repair is field-level where possible. An error must have a repair on one of its
named pages with changed fields compatible with the error category; a repair on
another page or an unrelated field does not satisfy this gate. Missing repairs
trigger a complete-audit correction within the existing two-attempt compiler
limit, with a cancellation checkpoint before retry. Warnings and validated-state
findings that cannot be patched through this contract retain their read-only
behavior. Page-only and panel-only repairs remain supported. Schema, identities,
frame geometry, and atomic persistence are unchanged.
Grounding instructions and full-audit retries explicitly require the typed
deterministic finding with empty source evidence, or exact named original and
unrepaired same-page draft quotes. Source-owned typed deterministic findings
are displayed individually with the same target page sets as their validation
catalog. Missing source-coverage checks link the identical issue code and a
visible repair; page-source grounding and full-source coverage refs stay distinct.
Missing checks may link an existing grounded content/continuity error directly
using the same code; density-only findings are excluded. The legacy omission
codes remain valid. Exact page, error severity, quote, known panel, and visible
repair gates are unchanged. This is an internal provider-side contract.
Source and continuity repairs check all
conflicting visible fields together while preserving source-faithful fields.
Deterministic fallback must use only entities
supported by the story context and must not promote unrelated work entities or
repopulate explicit empty lists for character-free cutaways.

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

Provider JSON constraints mirror the existing present/missing coverage contract:
present checks require one or two exact visible citations with null repair links;
missing checks require no output citations and a non-null same-code panel link.
Typed grounding source references are restricted to trusted catalog authorities
and explicitly supplied authorities; exact same-page quotations remain validated.

Handoff repair validation uses a service-built snapshot of original situation,
composition/custom-note, and background values. When a corrected field removes
an exact whole peer value of at least four normalized characters, retaining that
value in another field of the same panel triggers the existing bounded full-audit
retry. Unrelated fields, short or partial values, other panels, and other issue
categories are excluded. This internal snapshot is not persisted or exposed by
HTTP contracts, and contains no authority beyond the schema-safe current draft.
