# Character editor UI simplification

## Purpose and scope

- Move the existing reference image import control into the character editor, immediately before the free-description field.
- Hide the prompt-supplement and reproduction-anchor controls from the editor.
- Make clothing details a natural-language text area.
- Do not change API payloads, database fields, credit charging, upload validation, or generation behavior.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2 keeps character reference creation and confirmation as the supported workflow.
- Section 3 keeps the change inside `apps/web`; Route, Service, Repository, Domain, Infrastructure, Worker, and Mobile contracts remain unchanged.

## Interfaces and compatibility

- `EntityDraft.prompt_supplement` remains loaded and submitted so existing data is preserved even though the field is no longer shown.
- Existing anchor keys remain in `structured_fields` and continue to round-trip through the current parser and serializer.
- `clothing_description` remains the storage key. Only its editor changes from select/custom to a text area.
- Reference import continues to use `handleEntityImport`, the same accepted MIME types, active workspace scope, and one-credit operation.

## Security and failure behavior

- Authentication, organization scope, upload MIME filtering, API validation, and credit handling are unchanged.
- Import progress and user-facing errors continue to use the existing state and error paths.

## Test plan

- Add a Playwright regression test that verifies the import control precedes free description.
- Verify prompt supplement and anchors are absent from the UI.
- Verify clothing details is a natural-language text area rather than a select.
- Run web lint/build, backend tests/build, and the existing Playwright suite before publishing.

## Delegation

No Terra delegation. This is a tightly coupled, Web-only change across one component, its stylesheet, and one browser test; splitting ownership would add coordination cost without reducing risk.
