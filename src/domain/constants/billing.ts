export const MINIMUM_JPY_PER_CREDIT = 20;
export const ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT = 22;

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
    amountJpy: 10 * ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT,
  },
  credits_1000: {
    purchasedCredits: 50,
    amountJpy: 50 * ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT,
  },
  credits_3000: {
    purchasedCredits: 150,
    amountJpy: 150 * ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT,
  },
} as const;

export const ENTERPRISE_ADDITIONAL_CREDIT_JPY_PER_CREDIT = ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT;

export const ENTERPRISE_PLAN_DEFINITIONS = {
  enterprise_a: {
    displayNameJa: '\u30a8\u30f3\u30bf\u30fc\u30d7\u30e9\u30a4\u30ba\u30d7\u30e9\u30f3 A',
    monthlyCredits: 600,
    amountJpy: 10_000,
    minimumContractMonths: 1,
    trialDays: 0,
    paymentPolicy: 'card_preferred',
    serviceLevelPolicy: 'no_sla',
  },
  enterprise_b: {
    displayNameJa: '\u30a8\u30f3\u30bf\u30fc\u30d7\u30e9\u30a4\u30ba\u30d7\u30e9\u30f3 B',
    monthlyCredits: 2_000,
    amountJpy: 30_000,
    minimumContractMonths: 3,
    trialDays: 0,
    paymentPolicy: 'card_or_invoice_on_request',
    serviceLevelPolicy: 'slo_only',
  },
  enterprise_c: {
    displayNameJa: '\u30a8\u30f3\u30bf\u30fc\u30d7\u30e9\u30a4\u30ba\u30d7\u30e9\u30f3 C',
    monthlyCredits: 7_000,
    amountJpy: 100_000,
    minimumContractMonths: 6,
    trialDays: 0,
    paymentPolicy: 'invoice_available',
    serviceLevelPolicy: 'custom_sla_optional',
  },
} as const;

export const BILLING_PLAN_DEFINITIONS = {
  ...SUBSCRIPTION_PLAN_DEFINITIONS,
  ...ENTERPRISE_PLAN_DEFINITIONS,
} as const;

export const PAID_PLAN_CODES = [
  'standard',
  'premium',
  'enterprise_a',
  'enterprise_b',
  'enterprise_c',
] as const;

export const SUBSCRIPTION_PLAN_CODES = ['free', ...PAID_PLAN_CODES] as const;

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

export type ConsumerPaidPlanCode = Exclude<keyof typeof SUBSCRIPTION_PLAN_DEFINITIONS, 'free'>;
export type EnterprisePlanCode = keyof typeof ENTERPRISE_PLAN_DEFINITIONS;
export type PaidPlanCode = (typeof PAID_PLAN_CODES)[number];
export type SubscriptionPlanCode = (typeof SUBSCRIPTION_PLAN_CODES)[number];
export type CreditPackageCode = keyof typeof CREDIT_PACKAGE_DEFINITIONS;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS_VALUES)[number];

export function isEnterprisePlanCode(value: string): value is EnterprisePlanCode {
  return value in ENTERPRISE_PLAN_DEFINITIONS;
}

export function isPaidPlanCode(value: string | null | undefined): value is PaidPlanCode {
  return typeof value === 'string' && (PAID_PLAN_CODES as readonly string[]).includes(value);
}

export function isSubscriptionPlanCode(value: string | null | undefined): value is SubscriptionPlanCode {
  return typeof value === 'string' && (SUBSCRIPTION_PLAN_CODES as readonly string[]).includes(value);
}

export function getBillingPlanAmountJpy(planCode: PaidPlanCode): number {
  return BILLING_PLAN_DEFINITIONS[planCode].amountJpy;
}

export function getBillingPlanMonthlyCredits(planCode: PaidPlanCode): number {
  return BILLING_PLAN_DEFINITIONS[planCode].monthlyCredits;
}

export function getBillingPlanRank(planCode: SubscriptionPlanCode): number {
  switch (planCode) {
    case 'enterprise_c':
      return 5;
    case 'enterprise_b':
      return 4;
    case 'enterprise_a':
      return 3;
    case 'premium':
      return 2;
    case 'standard':
      return 1;
    case 'free':
      return 0;
  }
}
