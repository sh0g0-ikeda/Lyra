import { CREDIT_COSTS } from './credits.js';

export const THINKING_MODE_THRESHOLDS = {
  MAX_ENTITIES_FOR_STANDARD: 4,
  MAX_PANELS_FOR_STANDARD: 8,
} as const;

export const PAGE_GENERATION_QUALITY = {
  INITIAL: 'medium',
  REGENERATE: 'medium',
} as const;

export const PAGE_GENERATION_CREDIT_COSTS = {
  standard: CREDIT_COSTS.PAGE_GENERATION_STANDARD,
  thinking: CREDIT_COSTS.PAGE_GENERATION_THINKING,
  regenerate: CREDIT_COSTS.PAGE_REGENERATION,
} as const;

// Pricing is based on the page image request, with extra margin protection for
// reference-heavy pages because each attached entity reference adds image input cost.
export const PAGE_GENERATION_REFERENCE_BILLING = {
  INCLUDED_REFERENCE_COUNT: 3,
  EXTRA_CREDIT_PER_REFERENCE: 1,
} as const;

export function calculatePageGenerationCreditCost(referenceCount: number): number {
  const extraReferenceCount = Math.max(
    0,
    referenceCount - PAGE_GENERATION_REFERENCE_BILLING.INCLUDED_REFERENCE_COUNT,
  );

  return PAGE_GENERATION_CREDIT_COSTS.standard +
    extraReferenceCount * PAGE_GENERATION_REFERENCE_BILLING.EXTRA_CREDIT_PER_REFERENCE;
}

export const PAGE_GENERATION_STALE_AFTER_MS = 20 * 60 * 1000;
export const ENTITY_GENERATION_STALE_AFTER_MS = 20 * 60 * 1000;
export const EPISODE_LONG_JOB_STALE_AFTER_MS = 45 * 60 * 1000;
export const GENERATION_RECOVERY_BATCH_LIMIT = 100;
export const IMAGE_GENERATION_OPENAI_MAX_RETRIES = 1;

export const PAGE_GENERATION_INPUT_IMAGE_LIMITS = {
  MAX_ENTITY_REFERENCE_IMAGES: 12,
} as const;

export const DEFAULT_GENERATION_ACTIVE_JOB_LIMITS = {
  PER_USER: 2,
  GLOBAL: 10,
} as const;

export const MAX_PRODUCTION_GENERATION_ACTIVE_JOB_LIMITS = {
  PER_USER: 5,
  GLOBAL: 50,
} as const;

export const EPISODE_LONG_JOB_ACTIVE_JOB_TYPES = [
  'episode_story_autofill',
  'episode_page_skeleton',
] as const;

export const DEFAULT_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS = {
  PER_USER: 1,
  GLOBAL: 5,
} as const;

export const MAX_PRODUCTION_EPISODE_LONG_JOB_ACTIVE_JOB_LIMITS = {
  PER_USER: 2,
  GLOBAL: 20,
} as const;

export const PAGE_PROMPT_COMPILER_OPENAI_MODEL = 'gpt-5.4-mini';
export const PAGE_PROMPT_COMPILER_MAX_TOKENS = 900;
export const PAGE_PROMPT_COMPILER_VERSION = 'page_prompt_v4';

export const STYLE_REFERENCE_COMPILER_OPENAI_MODEL = 'gpt-5.4-mini';
export const STYLE_REFERENCE_COMPILER_MAX_TOKENS = 500;
export const STYLE_REFERENCE_COMPILER_VERSION = 'style_ref_v3';

export const PAGE_AUTOFILL_COMPILER_OPENAI_MODEL = 'gpt-4o-2024-08-06';
export const PAGE_AUTOFILL_COMPILER_MAX_TOKENS = 1200;
export const PAGE_AUTOFILL_COMPILER_VERSION = 'page_autofill_v3';

export const EPISODE_PAGE_PLAN_COMPILER_OPENAI_MODEL = 'gpt-5';
export const EPISODE_PAGE_PLAN_COMPILER_MAX_TOKENS = 24000;
export const EPISODE_PAGE_PLAN_COMPILER_VERSION = 'episode_page_plan_v3';

export const EPISODE_BEAT_PLAN_COMPILER_OPENAI_MODEL = 'gpt-5';
export const EPISODE_BEAT_PLAN_COMPILER_MAX_TOKENS = 16000;
export const EPISODE_BEAT_PLAN_COMPILER_VERSION = 'episode_beat_plan_v1';

export const EPISODE_PLAN_AUDIT_COMPILER_OPENAI_MODEL = 'gpt-5';
export const EPISODE_PLAN_AUDIT_COMPILER_MAX_TOKENS = 20_000;
export const EPISODE_PLAN_AUDIT_COMPILER_MAX_ATTEMPTS = 2;
export const EPISODE_PLAN_AUDIT_COMPILER_VERSION = 'episode_plan_audit_v4';

export const PAGE_GENERATION_PLANNER_MAX_TOKENS = 700;
export const PAGE_GENERATION_INTERNAL_PLAN_MAX_CHARS = 1200;
