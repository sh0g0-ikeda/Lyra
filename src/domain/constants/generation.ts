import { CREDIT_COSTS } from './credits.js';

export const THINKING_MODE_THRESHOLDS = {
  MAX_ENTITIES_FOR_STANDARD: 4,
  MAX_PANELS_FOR_STANDARD: 8,
} as const;

export const PAGE_GENERATION_QUALITY = {
  INITIAL: 'medium',
  REGENERATE: 'high',
} as const;

export const PAGE_GENERATION_CREDIT_COSTS = {
  standard: CREDIT_COSTS.PAGE_GENERATION_STANDARD,
  thinking: CREDIT_COSTS.PAGE_GENERATION_THINKING,
  regenerate: CREDIT_COSTS.PAGE_REGENERATION,
} as const;
