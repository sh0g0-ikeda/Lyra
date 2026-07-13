import { describe, expect, it } from 'vitest';
import {
  formatSubscriptionPlanLabel,
  getSubscriptionPlanRank,
  normalizeSubscriptionPlanCode,
} from '../../../apps/web/src/lib/billingContract.js';

describe('billing contract', () => {
  it('既知のプランの場合に選択言語の表示名を返す', () => {
    expect(formatSubscriptionPlanLabel('ja', 'premium')).toBe('プレミアム');
    expect(formatSubscriptionPlanLabel('en', 'premium')).toBe('Premium');
  });

  it('旧APIでプランがない場合にfreeとして扱う', () => {
    expect(normalizeSubscriptionPlanCode(undefined)).toBe('free');
    expect(getSubscriptionPlanRank(undefined)).toBe(0);
  });

  it('未知のプランの場合に権限を上げず安全な表示名を返す', () => {
    expect(normalizeSubscriptionPlanCode('future_plan')).toBeNull();
    expect(getSubscriptionPlanRank('future_plan')).toBe(-1);
    expect(formatSubscriptionPlanLabel('ja', 'future_plan')).toBe('不明なプラン');
    expect(formatSubscriptionPlanLabel('en', 'future_plan')).toBe('Unknown plan');
  });
});
