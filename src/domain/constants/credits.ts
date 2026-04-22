export const SIGNUP_BONUS_CREDITS = 200;

export const CREDIT_COSTS = {
  ENTITY_GENERATION: 15,
  PAGE_GENERATION_STANDARD: 25,
  PAGE_GENERATION_THINKING: 40,
} as const;

export type CreditLedgerType =
  | 'signup_bonus'
  | 'monthly_grant'
  | 'purchase'
  | 'consume'
  | 'refund';
