# Editorial and layout compatibility

This selective port reconciles the deployed-source editorial controls at `2debe8c3c22633ed077e7b189ddcfa8b209a00dc` with the current state-reference and immutable-quote implementation. It does not enable a provider, change a generation flag, or call a paid model.

## Saved layout and actual image input

`PageGenerationLayoutControl` resolves one complete frame map, with finite normalized coordinates and unique contiguous reading order. It supports the 19 known templates and valid custom/AI frame definitions. The prompt records each Pn physical position and scene binding. The exact map is saved inside the accepted quote, and its numbered PNG is the last input image after the canonical, deduplicated character/state references. It is excluded from reference billing. The authoritative layout suffix is appended after the compiler, optional internal plan, and monochrome constraint. It forbids mirroring, swapping scenes and printing guide labels in artwork.

Incomplete maps use explicit reading-order guidance without claiming an uploaded guide. A valid map whose guide cannot render fails before provider execution. Older accepted quote snapshots that omit the new map retain their original custom unnumbered guide behavior and do not reread current layout drafts.

The raster labels use 5×7 glyphs, 8px internal padding, and at least 12px clearance from frame edges. Labels shrink for narrow frames or are omitted if no readable safe position exists. Frame coordinates are unchanged. Local review outputs included `asymmetric-battle-7.png`, `custom-narrow-tall.png`, `full-page.png`, and `geometry.json`; they are separate review artifacts, not repository paths. Their visual review checks geometry and label legibility only; it is not app/device QA or a provider-artwork quality test.

## Dialogue and reading load

Visible cast and voice identity are independent. Same-work off-panel speech and thought retain their speaker IDs. Unknown voices are never reassigned to the nearest visible person. Narration has no speaker; thought and narration have no speech tails. Off-panel voices do not add a visible character or billable image reference. Assignment changes validate both visible subjects and stored voice IDs under the existing authorized work transaction lock.

Only newly compiled dialogue receives right-group then left-group positions in original array order. Stored manual dialogue positions are not rewritten. Generated suggestions and audit repairs allow at most four combined speech/thought/narration/shout/whisper entries; manual editing keeps the existing twenty-entry limit. The audit has an explicit `dialogue_density` issue, full dialogue with speaker IDs, real text counts and saved frame area. It reserves complete dialogue before compacting visual summaries and fails safely above its 150,000-character input bound rather than silently dropping conversation endings.

The beat ledger adds optional backward-compatible `textPlan` fields for required verbal information, visual-only beats, and density rationale. New provider output supplies them with the candidate's compact 45/60-character field bounds. Detail and audit prompts consume them. Existing outline, bounded eight-page ledger packs, retries, continuity repair, state snapshots and atomic persistence are retained. Skeleton prompts expose each template's geometry, focal position, dialogue room and reading order; `applyStoryPlan=false` behavior is unchanged.

## Model-profile and limit compatibility

`OPENAI_EPISODE_TEXT_PROFILE` remains `legacy` by default. The explicit deployed-source `balanced_v1` profile retains beat/audit `gpt-5.6-terra`, detail `gpt-5.6-luna`, and medium reasoning; legacy retains the existing `gpt-5` stages with reasoning omitted. These strings document source compatibility, not a recommendation or proof of current provider availability. No fallback or activation is added.

The candidate's 32-page skeleton cap remains. `docs/Lyra_StoryAI_SubSpec.md` explicitly permits 1–32 pages, and the candidate has global outline, bounded packs and output budgets supporting that cap. The deployed source's older 24-page cap was not silently imposed.

Changed prompt versions distinguish the combined implementation: page prompt v5, page autofill v6, episode detail v6, beat plan v3, outline v2, and audit v7. Unrelated style-reference and entity prompt versions remain unchanged.

## Verification

Tests cover template/custom map validation, last-image binding, compiler/planner/monochrome suffix precedence, immutable accepted-quote geometry, unchanged reference billing, old quote omission behavior, all-template numbered rendering, concave clipping, narrow-frame clearance, voice preservation, foreign-work rejection, new/manual dialogue limits, bounded complete audits, and explicit stage model/reasoning routing. All provider requests in tests are fakes. Disposable PostgreSQL 18 tests cover accepted snapshots, off-panel cast changes, foreign speaker rejection and provenance delivery.
