export const SIGNUP_BONUS_CREDITS = 12;

export const CREDIT_COSTS = {
  ENTITY_GENERATION: 1,
  PAGE_GENERATION_STANDARD: 1,
  PAGE_GENERATION_THINKING: 1,
  PAGE_REGENERATION: 1,
} as const;

export type CreditLedgerType =
  | 'signup_bonus'
  | 'monthly_grant'
  | 'purchase'
  | 'consume'
  | 'refund';
