import { describe, expect, it } from 'vitest';
import {
  organizationBillingPlansResponseSchema,
  organizationBillingSummaryResponseSchema,
  organizationCreditBalanceResponseSchema,
  organizationCreditCheckoutResponseSchema,
  organizationCustomerPortalResponseSchema,
  organizationInvoicesResponseSchema,
  organizationSubscriptionCheckoutResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const organization = {
  id: 'org-1',
  type: 'business',
  name: 'Lyra Studio',
  legal_name: null,
  status: 'active',
  plan_key: 'enterprise_a',
  billing_email: null,
  created_by_user_id: 'user-1',
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
};

const member = {
  id: 'member-1',
  organization_id: 'org-1',
  user_id: 'user-1',
  email: 'owner@example.com',
  display_name: null,
  role: 'owner',
  status: 'active',
  invited_by_user_id: null,
  joined_at: null,
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
};

const balance = {
  organization_id: 'org-1',
  monthly_credits: 0,
  purchased_credits: 0,
  total_credits: 0,
  monthly_expires_at: null,
  updated_at: '2026-07-30T00:00:00.000Z',
};

const plan = {
  plan_code: 'enterprise_a',
  display_name_ja: 'エンタープライズ A',
  display_name_en: 'Enterprise A',
  monthly_credits: 600,
  amount_jpy: 10_000,
  minimum_contract_months: 1,
  trial_days: 0,
  is_enterprise: true,
  configured: false,
};

describe('Organization billing response contract', () => {
  it('0残高・空一覧・null subscriptionとinvoice URLを受理する', () => {
    expect(organizationCreditBalanceResponseSchema.safeParse(balance).success).toBe(true);
    expect(organizationBillingPlansResponseSchema.safeParse({ subscription_plans: [] }).success).toBe(true);
    expect(
      organizationSubscriptionCheckoutResponseSchema.safeParse({
        session_id: 'cs_public_return_value',
        url: 'https://checkout.stripe.com/session',
      }).success,
    ).toBe(true);
    expect(
      organizationCreditCheckoutResponseSchema.safeParse({
        session_id: 'cs_public_return_value',
        package_code: 'credits_200',
        url: 'https://checkout.stripe.com/session',
      }).success,
    ).toBe(true);
    expect(
      organizationCustomerPortalResponseSchema.safeParse({
        url: 'https://billing.stripe.com/session',
      }).success,
    ).toBe(true);
    expect(
      organizationBillingSummaryResponseSchema.safeParse({
        workspace: { organization, membership: member, balance: null },
        subscription: null,
        subscription_plans: [plan],
      }).success,
    ).toBe(true);
    expect(
      organizationInvoicesResponseSchema.safeParse({
        invoices: [
          {
            id: 'payment-1',
            user_id: null,
            organization_id: 'org-1',
            kind: 'subscription',
            amount_jpy: 0,
            status: 'paid',
            invoice_url: null,
            created_at: '2026-07-30T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('Stripe内部field・未知enum・負数・空の必須値を拒否する', () => {
    expect(
      organizationBillingSummaryResponseSchema.safeParse({
        workspace: { organization, membership: member, balance },
        subscription: null,
        subscription_plans: [{ ...plan, stripe_price_id: 'price_private' }],
      }).success,
    ).toBe(false);
    expect(
      organizationCreditCheckoutResponseSchema.safeParse({
        session_id: 'cs_public_return_value',
        package_code: 'credits_unknown',
        url: 'https://checkout.stripe.com/session',
      }).success,
    ).toBe(false);
    expect(
      organizationInvoicesResponseSchema.safeParse({
        invoices: [
          {
            id: 'payment-1',
            user_id: null,
            organization_id: 'org-1',
            kind: 'subscription',
            amount_jpy: -1,
            status: 'paid',
            invoice_url: null,
            created_at: '2026-07-30T00:00:00.000Z',
            stripe_invoice_id: 'in_private',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      organizationSubscriptionCheckoutResponseSchema.safeParse({
        session_id: '',
        url: 'https://checkout.stripe.com/session',
      }).success,
    ).toBe(false);
  });
});
