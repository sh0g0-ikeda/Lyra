# Story Guidance Copy Design

## Purpose and scope

Make the Story screen understandable without prior knowledge by explaining three
existing controls: page planning, Story AI, and optional scene context. This is a
presentation-only change. It does not change generation requests, persistence,
credits, jobs, or backend contracts.

## Specification basis

`docs/Lyra_Unified_Spec_v4.md` sections 2 and 6 define the user flow as writing an
episode, optionally adding scenes, generating a page skeleton, and then applying
the story to editable panel fields. The new copy describes that existing order.

## Affected layer and interfaces

- Web: localized helper text in the existing Story panels.
- Input/output: no input, API, job, or storage changes.
- Localization: English source strings and explicit Japanese dictionary entries.

## Security and compatibility

No authentication, authorization, tenancy, upload, billing, or generated-output
path changes. Existing button labels and click handlers remain unchanged.

## Test plan

Add a Playwright contract test that verifies all three explanations in English,
then switches the UI to Japanese and verifies the Japanese text. Run the focused
test first, followed by web lint/build and the repository release gates.

## Delegation

No Terra delegation. The change is confined to one UI component, its localization
dictionary, and one browser contract test; splitting ownership would add more
coordination than implementation value.
