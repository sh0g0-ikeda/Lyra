# New-character draft defaults

## Scope and source

The adopted front-end design at `01c1bf6dc1057f1731770d4118e7508eee884433`,
`docs/uiux-backend-expansion-2026-09-30/design/05-フロント.md` §2 and §6 (4.1),
requires editable defaults on new person forms while preserving existing fields.
The reference proposal §4.4 maps directly to six existing enum values:
`gender_expression=male`, `age_range=twenties`, `skin_tone=fair`,
`first_impression=bright_friendly`, `standing_style=upright_neat`, and
`default_expression=soft_smile`.

Only these six unambiguous basic defaults are adopted here. Detailed §4.5 example
labels do not consistently map to existing choices. The front-end design explicitly
prioritizes structure and intent over example values, so this change neither
renames enum choices nor invents detailed presets. Face/hair/clothing stay collapsed
and retain all current choices. Unified Spec v4 §§2, 8 and 11 govern the existing
creation, bounded payload, and stored-value preservation contracts.

## Implementation boundaries

- Initialize the six values only for a fresh, unsaved `character` draft. Saved
  snapshots, including empty/null fields, and imported suggestions bypass defaults.
- Compare new-form dirty state with its initial editable values. Opening an untouched
  form must not request a save, while clearing a preset is a real user edit.
- Preserve edits when rerendering, expanding sections, changing state, or switching
  draft type. Person defaults never enter nonhuman/object payloads. An explicit new
  draft or guarded work/session/organization change starts a separate form.
- Keep saved-record parsing and update-payload merging unchanged. No data migration,
  backfill, automatic save, API/provider call, or paid action is introduced.
- Keep import revisions, candidate confirmation, reset/discard, hidden structured
  fields and aliases, and existing dirty guards intact.

## Verification plan

Add screen-level tests before implementation and record their failure. Verify new
visible values, editable/clearable defaults, explicit create payload, untouched
clean state, discard/new reset, preserved blanks/nulls when reopening saved assets,
import replacement, draft type boundaries and guarded scope transitions. Reuse
existing hidden-field/candidate tests, then run the full Mobile tests, typecheck,
lint and generated-contract check. Tests use in-memory mocks and never contact
production, stores, or providers.

## Local evidence

- RED: the first 13 screen tests produced 10 failures and 3 passes before the
  implementation. Additional boundary tests demonstrated rejection failures for
  an old same-value draft import and nonhuman/object hydration during type change;
  both are now covered by passing regression tests.
- GREEN: 19 new screen tests plus the existing hidden-field, character UI contract,
  reload and entity mutation tests pass: 5 files, 33 tests. Workspace/editor UI
  contract coverage also passes: 2 files, 20 tests.
- Mobile TypeScript and generated API contract checks pass. Targeted lint on the
  character screen and both changed tests passes. `git diff --check` passes.
- A full Mobile run during concurrent sibling work found only their in-progress
  error-context and contrast tests failing (182 suites passed, 4 failed). The
  coordinating release task runs the final combined suite after all edits settle;
  this document does not claim that earlier aggregate run passed.

No production, store, provider, repository publish or migration action was taken.

## Selected-record loading boundary

Review reproduced a separate draft-lifecycle regression: while an existing selected
record was still unresolved, editable controls accepted input with no dirty state;
the eventual server snapshot overwrote it. Before changing that behavior, the
focused regression test observed `Typed while loading` replaced by `Saved hero`.
The editor body will remain unavailable until an existing selection resolves, with
localized loading/failure copy. The asset picker and new-draft escape remain usable;
load errors retain the operation-aware refresh action. Once data is loaded, normal
dirty guards and editing resume. This avoids guessing how to merge input written
before its server baseline was known.

The loading gate is now implemented. JA/EN tests verify unavailable editing/import
controls while loading or failed, the read-only retry, escape to a usable new draft,
and preservation of edits made after hydration. Mobile typecheck and targeted lint
passed again after this follow-up. An additional catalog check identified a sibling
operation-error localization issue and reported it to its owner; the release
coordinator retains the final aggregate-check responsibility.

## Final combined UI checkpoint

After all coordinated changes froze, the full Mobile suite passed 186 files /
1,011 tests, typecheck, full lint, generated contracts and mojibake checks. Earlier
in-progress sibling failures and intermediate counts above are historical evidence,
not the final result. The delivered manifest pins this result to the final source
commit; browser/native and live external acceptance remain unrun.
