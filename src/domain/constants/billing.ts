export const MINIMUM_JPY_PER_CREDIT = 60;

export const SUBSCRIPTION_PLAN_DEFINITIONS = {
  free: {
    monthlyCredits: 0,
    amountJpy: 0,
  },
  standard: {
    monthlyCredits: 50,
    amountJpy: 50 * MINIMUM_JPY_PER_CREDIT,
  },
  premium: {
    monthlyCredits: 175,
    amountJpy: 175 * MINIMUM_JPY_PER_CREDIT,
  },
} as const;

export const CREDIT_PACKAGE_DEFINITIONS = {
  credits_200: {
    purchasedCredits: 10,
    amountJpy: 10 * MINIMUM_JPY_PER_CREDIT,
  },
  credits_1000: {
    purchasedCredits: 50,
    amountJpy: 50 * MINIMUM_JPY_PER_CREDIT,
  },
  credits_3000: {
    purchasedCredits: 150,
    amountJpy: 150 * MINIMUM_JPY_PER_CREDIT,
  },
} as const;

export const SUBSCRIPTION_STATUS_VALUES = [
  'active',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'past_due',
  'paused',
  'trialing',
  'unpaid',
] as const;

export type PaidPlanCode = Exclude<keyof typeof SUBSCRIPTION_PLAN_DEFINITIONS, 'free'>;
export type SubscriptionPlanCode = keyof typeof SUBSCRIPTION_PLAN_DEFINITIONS;
export type CreditPackageCode = keyof typeof CREDIT_PACKAGE_DEFINITIONS;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS_VALUES)[number];
