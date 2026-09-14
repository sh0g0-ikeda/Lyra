# Story editorial integrity

## Design and release scope

User-approved outcome: preserve off-panel speakers and internal monologue, prevent
late-page text dumping, and choose readable panel layouts for story purpose; design,
implement, independently review, validate and deploy API/Worker/Web as needed.
Spec basis: Unified Spec sections 2–6, 8–10 and StoryAI Sub-Spec sections 3–8.
Baseline: 8b10184 (production API 131 / Worker 74 verified on 2026-09-14).
Use this isolated worktree. The root worktree's eight pending four-line-limit edits
are incorporated here without reverting or deploying its unrelated changes.

## Interfaces and invariants

- Speaker identity is independent of visible panel assignments. Preserve the actual
  authorized work entity ID for off-panel speech AND thought; never substitute a
  visible listener. Derive visibility from assignments where possible to retain
  existing Web/Mobile contracts. Narration has no speaker. Unknown speakers must
  not become an arbitrary visible person. Do not infer visibility from ID alone.
- Image-baked text must name its real speaker and whether that speaker is visible.
  Off-panel speech and thought must not point at the visible listener. Deterministic
  balloons use no speech tail for thought or off-panel/ambiguous speakers; on-panel
  speech may use the assigned subject's side, never an unconditional center target.
- AI-authored dialogue arrays count speech, thought, shout, whisper and narration
  together, maximum four items after normalization and immediately before save.
  Four is a ceiling, not a target. Do not truncate or hide excess items, merge
  different speakers into a single item, or clear text only to pass validation.
  Manual legacy documents remain readable/editable; shared limits must not break
  old saved inputs. Empty-array repairs must really clear old dialogue.
- Plan text intent and visual/silent beats across the entire episode before detail
  expansion. Source evidence outranks a generated ledger; a repair cannot freely
  move owned beats to frozen pages. Balance considers meaningful content, total
  text length, panel area and story rhythm, not equal line counts or blanket
  prohibitions on silent openings or dialogue-heavy endings.
- Frame geometry is actual layout; panel_size is only an editorial label. Preserve
  valid selected layouts, custom frames and identities. Skeleton selection gets
  the complete supported template catalog with shape/reading-order information.
  Story-appropriate variety is a preference; intentional repeated grids are valid.
  Do not choose layouts randomly or change existing user layouts without an
  explicit layout-generation operation. Fix any metadata repair that resets a
  valid nondefault layout to the count's default.
- Keep source text separate from trusted task constraints, remove contradictory
  narration pressure, preserve supported deliberate flashbacks/repeated motifs,
  and align generation, audit and repair instructions. All generation modes and
  persistence paths must enforce the hard four-item condition.

## Evidence informing the instructions

- OpenAI, GPT-5 Prompt Migration and Improvement: remove contradictory instructions
  and unclear format contracts, then evaluate actual task behavior.
  https://developers.openai.com/cookbook/examples/gpt-5/prompt-optimization-cookbook
- Steve Ellis, Pro Artist's Guide to Comic & Manga Layouts (Celsys): plan page
  progression and thumbnails, then size focal panels and control reading flow and
  pacing. These principles motivate layout choices, not a rigid variety quota.
  https://www.clipstudio.net/how-to-draw/archives/160963

## Ownership and validation

Sol: speaker integrity, balloon/image speaker output, PageService integration and
behavior tests. Terra: skeleton layout choice/catalog and layout helper tests.
Parent: generation/audit prompts and schemas, density checks, design/spec, release
integration. One writer per file; workers coordinate PageService changes through
Sol and do not deploy or recurse. Independent review follows integration.

TDD cases: off-panel speech/thought retains A while B is visible; thought has no
speech tail; valid author-selected layouts survive autofill; all supported shapes
remain selectable; four is accepted, five rejected after normalization; empty
dialogue clears prior content; residual over-limit repairs cannot persist; quiet
opening and intentional repeated layouts are not mechanically rejected.
Run focused tests, full Vitest/Bun, builds/contracts, PostgreSQL migration/invariant,
Web lint/build/Playwright and applicable Mobile compatibility checks. Live model
output is a separate bounded evaluation from mocked tests.

Release only reviewed artifacts against exact deployed bases, preserving unrelated
runtime behavior, credentials references, task settings and Web association files.
Recheck release base immediately before deployment; verify migration/invariants,
API readiness, Worker health, queues, logs and artifact digests. Roll back if those
regress. No user manga is bulk-rewritten; existing generated images need explicit
regeneration to reflect the new instructions.

## Implemented boundaries and review

- AI response schemas enforce four entries; the internal/legacy representation
  still accepts twenty. Normalization and all AI persistence paths recheck the
  ceiling. Single-page autofill prepares every merge before its first write, so
  a later invalid panel cannot leave earlier settings or panels partially saved.
- The audit retains complete dialogue text and speaker/type/position metadata,
  including legacy over-limit arrays. It reserves this before visual summaries
  and fails explicitly if complete dialogue cannot fit its 150,000-character
  input budget. Counts alone never stand in for missing text.
- Actual frame coordinates reach single-page, full-story and audit inputs.
  Nineteen existing template geometries now have editorial descriptions; valid
  model-selected templates and existing nondefault/custom layouts are preserved.
- The Mobile speaker selector and local validation use authorized work entities,
  independently of visible panel assignments. No native store/OTA release is
  included in this server deployment; those source changes are verified here.
- Independent review covered schema wiring, full-text budgeting, persistence
  preflight, frame metadata and the API-before-Worker release gates. No blocking
  finding remained at integration review.

## Local validation evidence

- Speaker/persistence/readiness/prompt/balloon focused suite: 147 tests passed.
- Editorial/compiler/continuity/layout focused suite: 68 tests passed; repository
  propagation and optional layout handling were subsequently covered as well.
- Mobile complete suite: 130 files, 617 tests passed; explicit TypeScript 6 check
  passed. Existing Expo/lint dependency incompatibilities were not updated.
- Web: lint, strict production build and all 28 Playwright smoke tests passed.
  Public Cognito configuration and native association hashes were captured and
  preserved for the strict build, with developer authentication bypass disabled.
- Backend build, generated contracts and Bun's 26 entrypoint tests passed.
- The first unrestricted-parallel full Vitest run had a stale contract-order
  failure and an image-composition failure. Contract order was corrected; the
  image test passed alone. The final full run uses four workers and is recorded
  separately in the ignored release evidence directory: 1,712 tests passed,
  zero failed, four existing environment-dependent tests skipped.

Live-model evaluation uses only a synthetic three-page story, never user works,
database writes, queues or image generation. It verifies off-panel mother speech
and thought while only her child is visible, a quiet opening/ending, and the
four-entry ceiling. The first audit caught dialogue in the wrong source panel;
the second supplied staging-note repairs to clarify off-panel voice ownership.
Both field-level repair passes use the existing production repair helper.
An additional evaluation-only third audit of the final repaired sample returned
accepted=true with no issues. Final panel text counts were [0,1,0,0], [1,1,1,0]
and [0,1,0,0]. This checks text planning and repair behavior, not rendered image
quality or a statistical success rate; production's bounded audit count is unchanged.
