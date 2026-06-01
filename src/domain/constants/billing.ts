export const SUBSCRIPTION_PLAN_DEFINITIONS = {
  free: {
    monthlyCredits: 0,
  },
  standard: {
    monthlyCredits: 50,
  },
  premium: {
    monthlyCredits: 175,
  },
} as const;

export const CREDIT_PACKAGE_DEFINITIONS = {
  credits_200: {
    purchasedCredits: 10,
    amountJpy: 500,
  },
  credits_1000: {
    purchasedCredits: 50,
    amountJpy: 2250,
  },
  credits_3000: {
    purchasedCredits: 150,
    amountJpy: 6000,
  },
} as const;

export type PaidPlanCode = Exclude<keyof typeof SUBSCRIPTION_PLAN_DEFINITIONS, 'free'>;
export type SubscriptionPlanCode = keyof typeof SUBSCRIPTION_PLAN_DEFINITIONS;
export type CreditPackageCode = keyof typeof CREDIT_PACKAGE_DEFINITIONS;
