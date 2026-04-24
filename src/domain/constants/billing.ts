export const SUBSCRIPTION_PLAN_DEFINITIONS = {
  free: {
    monthlyCredits: 0,
  },
  standard: {
    monthlyCredits: 1000,
  },
  premium: {
    monthlyCredits: 3500,
  },
} as const;

export const CREDIT_PACKAGE_DEFINITIONS = {
  credits_200: {
    purchasedCredits: 200,
    amountJpy: 500,
  },
  credits_1000: {
    purchasedCredits: 1000,
    amountJpy: 2000,
  },
  credits_3000: {
    purchasedCredits: 3000,
    amountJpy: 5000,
  },
} as const;

export type PaidPlanCode = Exclude<keyof typeof SUBSCRIPTION_PLAN_DEFINITIONS, 'free'>;
export type SubscriptionPlanCode = keyof typeof SUBSCRIPTION_PLAN_DEFINITIONS;
export type CreditPackageCode = keyof typeof CREDIT_PACKAGE_DEFINITIONS;
