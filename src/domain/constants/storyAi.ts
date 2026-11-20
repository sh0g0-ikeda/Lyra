export const STORY_AI_LOW_COST_MODEL = 'gpt-5.4-mini';

export const STORY_COLLABORATION_MODEL = STORY_AI_LOW_COST_MODEL;
export const PAGE_SKELETON_MODEL = STORY_AI_LOW_COST_MODEL;
export const STORY_EPISODE_IMPROVEMENT_WRITER_MODEL = STORY_AI_LOW_COST_MODEL;
export const STORY_EPISODE_IMPROVEMENT_PLANNER_OPENAI_MODEL = STORY_AI_LOW_COST_MODEL;
export const STORY_EPISODE_IMPROVEMENT_AUDITOR_OPENAI_MODEL = STORY_AI_LOW_COST_MODEL;

// Episode character appearance extraction and its independent whole-manuscript
// reconciliation intentionally share one isolated provider policy. Keeping this
// separate prevents a quality rollout from changing collaboration, planning or
// any image-generation path.
export const CHARACTER_AUTOFILL_OPENAI_MODEL = 'gpt-6-luna';
export const CHARACTER_AUTOFILL_REASONING_EFFORT = 'low' as const;
export const CHARACTER_AUTOFILL_EXTRACTION_MAX_TOKENS = 16_000;
export const CHARACTER_AUTOFILL_COVERAGE_MAX_TOKENS = 8_000;

// Page estimation is an isolated read-only policy. Do not reuse the general
// collaboration model: the product contract pins this bounded count to Luna.
export const STORY_PAGE_ESTIMATE_OPENAI_MODEL = 'gpt-6-luna';
export const STORY_PAGE_ESTIMATE_REASONING_EFFORT = 'low' as const;
export const STORY_PAGE_ESTIMATE_MAX_TOKENS = 8_192;
export const STORY_PAGE_ESTIMATE_MAX_PANELS = 1_000;
export const STORY_PAGE_ESTIMATE_PANELS_PER_PAGE = 4;
export const STORY_EPISODE_MANUSCRIPT_IMPROVEMENT_MAX_TOKENS = 16_000;
export const STORY_EPISODE_MANUSCRIPT_MAX_FRAGMENTS = 256;

export const STORY_AI_LIMITS = {
  instructionMaxLength: 2000,
  currentDraftMaxLength: 20000,
  selectedTextMaxLength: 4000,
  notesMaxLength: 4000,
  listEntryMaxLength: 300,
  listMaxItems: 20,
  maxSkeletonPages: 32,
  maxPanelsPerPage: 8,
  maxEntitiesPerPanel: 8,
  maxStreamingChars: 24000,
  maxEstimatedPanels: STORY_PAGE_ESTIMATE_MAX_PANELS,
  maxEstimatedBlocks: 256,
} as const;

// The global episode ledger is an internal planning artifact. Keep its text
// bounded independently from editable page and panel fields so a large episode
// cannot exhaust a single structured-output response.
export const EPISODE_BEAT_PLAN_TEXT_LIMITS = {
  storyBeatChars: 45,
  entryExitChars: 60,
  newInformationChars: 45,
  maxNewInformationItems: 2,
  dialogueIntentChars: 60,
  handoffChars: 60,
} as const;

export const STORY_COLLABORATION_MAX_TOKENS = 3000;
export const PAGE_SKELETON_MAX_TOKENS = 12000;
export const STORY_EPISODE_IMPROVEMENT_WRITER_MAX_TOKENS = 3200;
export const STORY_EPISODE_IMPROVEMENT_PLANNER_MAX_TOKENS = 2200;
export const STORY_EPISODE_IMPROVEMENT_AUDITOR_MAX_TOKENS = 1600;
