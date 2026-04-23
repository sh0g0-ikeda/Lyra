export const SIGNUP_BONUS_CREDITS = 200;

export const CREDIT_COSTS = {
  ENTITY_GENERATION: 8,
  PAGE_GENERATION_STANDARD: 10,
  PAGE_GENERATION_THINKING: 14,
  PAGE_REGENERATION: 22,
} as const;

export type CreditLedgerType =
  | 'signup_bonus'
  | 'monthly_grant'
  | 'purchase'
  | 'consume'
  | 'refund';
