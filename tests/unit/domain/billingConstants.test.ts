import { describe, expect, it } from 'vitest';
import {
  CREDIT_PACKAGE_DEFINITIONS,
  MINIMUM_JPY_PER_CREDIT,
  ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT,
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

  it('keeps paid subscriptions at or above 20 JPY per monthly credit', () => {
    for (const [planCode, definition] of Object.entries(SUBSCRIPTION_PLAN_DEFINITIONS)) {
      if (planCode === 'free') {
        continue;
      }

      expect(definition.amountJpy).toBeGreaterThanOrEqual(
        definition.monthlyCredits * MINIMUM_JPY_PER_CREDIT,
      );
    }
  });
});
