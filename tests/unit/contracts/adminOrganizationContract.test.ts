import { describe, expect, it } from 'vitest';
import {
  adminOrganizationContractResponseSchema,
  organizationCreditBalanceResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

describe('Admin organization response contract', () => {
  it('既存contract summaryと0残高・null日時を受理する', () => {
    expect(
      adminOrganizationContractResponseSchema.safeParse({
        organization: {
          id: 'org-1',
          name: 'Lyra Enterprise',
          status: 'active',
          plan_key: 'enterprise_c',
          billing_email: null,
          updated_at: '2026-07-30T00:00:00.000Z',
        },
      }).success,
    ).toBe(true);
    expect(
      organizationCreditBalanceResponseSchema.safeParse({
        organization_id: 'org-1',
        monthly_credits: 0,
        purchased_credits: 0,
        total_credits: 0,
        monthly_expires_at: null,
        updated_at: '2026-07-30T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('Stripe内部field・未知enum・負数を拒否する', () => {
    expect(
      adminOrganizationContractResponseSchema.safeParse({
        organization: {
          id: 'org-1',
          name: 'Lyra Enterprise',
          status: 'unknown',
          plan_key: 'enterprise_c',
          billing_email: null,
          updated_at: '2026-07-30T00:00:00.000Z',
          stripe_subscription_id: 'sub_private',
        },
      }).success,
    ).toBe(false);
    expect(
      organizationCreditBalanceResponseSchema.safeParse({
        organization_id: 'org-1',
        monthly_credits: -1,
        purchased_credits: 0,
        total_credits: -1,
        monthly_expires_at: null,
        updated_at: '2026-07-30T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
