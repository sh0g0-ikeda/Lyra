export type UiLanguage = 'ja' | 'en';

export type SubscriptionPlanCode =
  | 'free'
  | 'standard'
  | 'premium'
  | 'enterprise_a'
  | 'enterprise_b'
  | 'enterprise_c';

const subscriptionPlanLabels: Record<SubscriptionPlanCode, { en: string; ja: string }> = {
  free: { en: 'Free', ja: 'フリー' },
  standard: { en: 'Standard', ja: 'スタンダード' },
  premium: { en: 'Premium', ja: 'プレミアム' },
  enterprise_a: { en: 'Enterprise A', ja: 'エンタープライズ A' },
  enterprise_b: { en: 'Enterprise B', ja: 'エンタープライズ B' },
  enterprise_c: { en: 'Enterprise C', ja: 'エンタープライズ C' },
};

export function normalizeSubscriptionPlanCode(value: unknown): SubscriptionPlanCode | null {
  if (value === undefined || value === null || value === '') {
    return 'free';
  }

  return typeof value === 'string' && Object.hasOwn(subscriptionPlanLabels, value)
    ? (value as SubscriptionPlanCode)
    : null;
}

export function formatSubscriptionPlanLabel(language: UiLanguage, value: unknown): string {
  const planCode = normalizeSubscriptionPlanCode(value);
  if (planCode === null) {
    return language === 'en' ? 'Unknown plan' : '不明なプラン';
  }

  return subscriptionPlanLabels[planCode][language];
}

export function getSubscriptionPlanRank(value: unknown): number {
  const planCode = normalizeSubscriptionPlanCode(value);
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
    case null:
      return -1;
  }
}
