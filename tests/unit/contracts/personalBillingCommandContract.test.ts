import { describe, expect, it } from 'vitest';
import {
  billingCreditCheckoutResponseSchema,
  billingCustomerPortalResponseSchema,
  billingSubscriptionCheckoutResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

describe('Personal billing command response contract', () => {
  it('既存checkout・portal wireを受理する', () => {
    expect(
      billingSubscriptionCheckoutResponseSchema.safeParse({
        session_id: 'cs_subscription',
        url: 'https://checkout.stripe.com/subscription',
      }).success,
    ).toBe(true);
    expect(
      billingCreditCheckoutResponseSchema.safeParse({
        session_id: 'cs_credits',
        package_code: 'credits_3000',
        url: 'https://checkout.stripe.com/credits',
      }).success,
    ).toBe(true);
    expect(
      billingCustomerPortalResponseSchema.safeParse({
        url: 'https://billing.stripe.com/portal',
      }).success,
    ).toBe(true);
  });

  it('空の必須値・未知package・Stripe内部fieldを拒否する', () => {
    expect(
      billingSubscriptionCheckoutResponseSchema.safeParse({
        session_id: '',
        url: 'https://checkout.stripe.com/subscription',
      }).success,
    ).toBe(false);
    expect(
      billingCreditCheckoutResponseSchema.safeParse({
        session_id: 'cs_credits',
        package_code: 'credits_unknown',
        url: 'https://checkout.stripe.com/credits',
      }).success,
    ).toBe(false);
    expect(
      billingCustomerPortalResponseSchema.safeParse({
        url: 'https://billing.stripe.com/portal',
        stripe_customer_id: 'cus_private',
      }).success,
    ).toBe(false);
  });
});
