import { describe, expect, it } from 'vitest';
import {
  CREDIT_PACKAGE_DEFINITIONS,
  ENTERPRISE_ADDITIONAL_CREDIT_JPY_PER_CREDIT,
  ENTERPRISE_PLAN_DEFINITIONS,
  MINIMUM_JPY_PER_CREDIT,
  ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT,
  PAID_PLAN_CODES,
  SUBSCRIPTION_PLAN_DEFINITIONS,
} from '../../../src/domain/constants/billing.js';

describe('billing constants', () => {
  it('keeps one-time credit packages above subscription credit price', () => {
    expect(ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT).toBeGreaterThan(MINIMUM_JPY_PER_CREDIT);
  });

  it('keeps credit packages at or above the one-time package price per credit', () => {
    for (const definition of Object.values(CREDIT_PACKAGE_DEFINITIONS)) {
      expect(definition.amountJpy).toBeGreaterThanOrEqual(
        definition.purchasedCredits * ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT,
      );
    }
  });

  it('keeps consumer paid subscriptions at or above 20 JPY per monthly credit', () => {
    for (const [planCode, definition] of Object.entries(SUBSCRIPTION_PLAN_DEFINITIONS)) {
      if (planCode === 'free') {
        continue;
      }

      expect(definition.amountJpy).toBeGreaterThanOrEqual(
        definition.monthlyCredits * MINIMUM_JPY_PER_CREDIT,
      );
    }
  });

  it('defines enterprise plans as cheaper monthly contracts without trial credits', () => {
    expect(ENTERPRISE_PLAN_DEFINITIONS.enterprise_a).toMatchObject({
      displayNameJa: '\u30a8\u30f3\u30bf\u30fc\u30d7\u30e9\u30a4\u30ba\u30d7\u30e9\u30f3 A',
      amountJpy: 10_000,
      monthlyCredits: 600,
      minimumContractMonths: 1,
      trialDays: 0,
    });
    expect(ENTERPRISE_PLAN_DEFINITIONS.enterprise_b).toMatchObject({
      displayNameJa: '\u30a8\u30f3\u30bf\u30fc\u30d7\u30e9\u30a4\u30ba\u30d7\u30e9\u30f3 B',
      amountJpy: 30_000,
      monthlyCredits: 2_000,
      minimumContractMonths: 3,
      trialDays: 0,
    });
    expect(ENTERPRISE_PLAN_DEFINITIONS.enterprise_c).toMatchObject({
      displayNameJa: '\u30a8\u30f3\u30bf\u30fc\u30d7\u30e9\u30a4\u30ba\u30d7\u30e9\u30f3 C',
      amountJpy: 100_000,
      monthlyCredits: 7_000,
      minimumContractMonths: 6,
      trialDays: 0,
    });

    for (const definition of Object.values(ENTERPRISE_PLAN_DEFINITIONS)) {
      expect(definition.amountJpy / definition.monthlyCredits).toBeLessThan(MINIMUM_JPY_PER_CREDIT);
      expect(definition.monthlyCredits).toBeGreaterThan(0);
    }
  });

  it('includes enterprise plans in paid plan checkout codes', () => {
    expect(PAID_PLAN_CODES).toEqual(['standard', 'premium', 'enterprise_a', 'enterprise_b', 'enterprise_c']);
  });

  it('keeps enterprise additional credits at the same unit price as one-time credit packages', () => {
    expect(ENTERPRISE_ADDITIONAL_CREDIT_JPY_PER_CREDIT).toBe(ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT);
  });
});