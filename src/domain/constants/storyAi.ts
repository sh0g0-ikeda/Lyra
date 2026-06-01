export const STORY_COLLABORATION_MODEL = 'claude-sonnet-4-20250514';
export const PAGE_SKELETON_MODEL = 'claude-sonnet-4-20250514';
export const STORY_EPISODE_IMPROVEMENT_WRITER_MODEL = 'claude-sonnet-4-20250514';
export const STORY_EPISODE_IMPROVEMENT_PLANNER_OPENAI_MODEL = 'gpt-5.4-mini';
export const STORY_EPISODE_IMPROVEMENT_AUDITOR_OPENAI_MODEL = 'gpt-5.4-mini';

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
} as const;

export const STORY_COLLABORATION_MAX_TOKENS = 3000;
export const PAGE_SKELETON_MAX_TOKENS = 6000;
export const STORY_EPISODE_IMPROVEMENT_WRITER_MAX_TOKENS = 3200;
export const STORY_EPISODE_IMPROVEMENT_PLANNER_MAX_TOKENS = 2200;
export const STORY_EPISODE_IMPROVEMENT_AUDITOR_MAX_TOKENS = 1600;
