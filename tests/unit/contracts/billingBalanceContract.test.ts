import { describe, expect, it } from 'vitest';
import { billingBalanceSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validBalance = {
  monthly_credits: 25,
  purchased_credits: 15,
  total_credits: 40,
  monthly_expires_at: '2026-08-15T00:00:00.000Z',
  plan_code: 'standard',
  current_period_end: '2026-09-01T00:00:00.000Z',
  cancel_at_period_end: false,
  subscription_plans: [
    {
      plan_code: 'standard',
      display_name_ja: 'スタンダード',
      display_name_en: 'Standard',
      monthly_credits: 50,
      amount_jpy: 1000,
      minimum_contract_months: 1,
      trial_days: 0,
      is_enterprise: false,
      configured: true,
    },
  ],
};

describe('billingBalanceSchema', () => {
  it('購読期間と解約予定を含む残高responseを受理する', () => {
    expect(billingBalanceSchema.safeParse(validBalance).success).toBe(true);
  });

  it('購読期間または解約予定が欠けたresponseを拒否する', () => {
    const { current_period_end: _currentPeriodEnd, ...missingPeriodEnd } = validBalance;
    const { cancel_at_period_end: _cancelAtPeriodEnd, ...missingCancellation } = validBalance;

    expect(billingBalanceSchema.safeParse(missingPeriodEnd).success).toBe(false);
    expect(billingBalanceSchema.safeParse(missingCancellation).success).toBe(false);
  });

  it('負数creditと文字列の解約予定を拒否する', () => {
    expect(
      billingBalanceSchema.safeParse({
        ...validBalance,
        monthly_credits: -1,
      }).success,
    ).toBe(false);
    expect(
      billingBalanceSchema.safeParse({
        ...validBalance,
        cancel_at_period_end: 'false',
      }).success,
    ).toBe(false);
  });
});
