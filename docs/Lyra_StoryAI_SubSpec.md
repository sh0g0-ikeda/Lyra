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

The normal episode audit returns accepted, issues, page_repairs and panel_repairs.
It reviews original facts, continuing actions, dialogue/speaker placement, visible
beats and cross-page continuity. Useful repairs remain field-level. Auxiliary
source-coverage, grounding and per-unit proofs are not required in the response or
requested in the normal prompt. A patchless semantic finding does not invalidate
the typed result or another valid patch; an old expression quoted in a negative
explanation is not by itself a malformed repair.

Schema, bounded values, known targets, unique changed fields and matching patch
values remain hard checks. Page/panel identities, frame counts and geometry cannot
be changed by audit repairs. Invalid structured responses retain the existing
bounded retry with cancellation checkpoints. The first audit is required; a clean
first audit ends review without an identical second audit, even with a state ledger.
After useful repairs, at most one further audit may run. If that second audit is
unavailable, or semantic-only findings remain after bounded repair, the draft
proceeds through the existing deterministic validation instead of being discarded.
Actual invalid state references, deterministic duplicate errors, authorization,
cancellation, concurrency and atomic saving remain hard controls. State IDs and
reference readiness are independently revalidated before and under the save lock.

Source and continuity repairs should reconcile conflicting visible fields while
preserving source-faithful fields. Deterministic fallback uses only entities
supported by the story context and does not promote unrelated work entities or
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

Source-owned audit prompts render original source once as an ordered canonical
global-preface and page-source section. The raw original slices, page ownership,
global chronology, exact source quotations, offsets and state authorities remain
unchanged. Complete original source, dialogue and minimum panel evidence reserve
their space before optional displays; insufficient capacity fails closed.
Page ownership and original state authorities remain available without auxiliary
proof-output requirements. Client APIs, detail prompts, provider model, reasoning,
retry limits, output limits and atomic persistence are unchanged.

Normal audit regression checks additionally cover four-field-only responses,
patchless and mixed findings, clean state-aware review with one call, unavailable
second audit with state context, invalid repair values/targets, and preservation
of cancellation, conflict and atomic-save behavior.
