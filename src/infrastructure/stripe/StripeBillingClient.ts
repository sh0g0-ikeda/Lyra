import Stripe from 'stripe';
import type { CreditPackageCode, PaidPlanCode, SubscriptionPlanCode } from '../../domain/constants/billing.js';
import { isSubscriptionPlanCode } from '../../domain/constants/billing.js';
import { ValidationError } from '../../domain/errors/index.js';

export interface CreateStripeCustomerInput {
  userId: string;
  email: string;
  organizationId?: string | null;
  name?: string | null;
}

export interface CreateStripeCheckoutSessionInput {
  customerId: string;
  priceId: string;
  mode: 'payment' | 'subscription';
  successUrl: string;
  cancelUrl: string;
  userId: string;
  organizationId?: string | null;
  planCode?: PaidPlanCode;
  packageCode?: CreditPackageCode;
}

export interface CreateStripeSubscriptionUpdatePortalSessionInput {
  customerId: string;
  subscriptionId: string;
  subscriptionItemId: string;
  priceId: string;
  quantity: number;
  returnUrl: string;
}

export interface StripeBillingClientPort {
  createCustomer(input: CreateStripeCustomerInput): Promise<{ id: string }>;
  createCheckoutSession(input: CreateStripeCheckoutSessionInput): Promise<{ id: string; url: string }>;
  createCustomerPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  createSubscriptionUpdatePortalSession(
    input: CreateStripeSubscriptionUpdatePortalSessionInput,
  ): Promise<{ id: string; url: string }>;
  constructWebhookEvent(payload: Buffer, signature: string): Promise<Stripe.Event>;
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  cancelSubscription?(subscriptionId: string): Promise<void>;
}

export class StripeBillingClient implements StripeBillingClientPort {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  public constructor(secretKey: string, webhookSecret: string) {
    this.stripe = new Stripe(secretKey, {
      maxNetworkRetries: 2,
      timeout: 30_000,
    });
    this.webhookSecret = webhookSecret;
  }

  public async createCustomer(input: CreateStripeCustomerInput): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create(
      {
        email: input.email,
        name: input.name ?? undefined,
        metadata: {
          user_id: input.userId,
          lyra_organization_id: input.organizationId ?? '',
          organization_id: input.organizationId ?? '',
        },
      },
      {
        idempotencyKey:
          input.organizationId !== null && input.organizationId !== undefined
            ? `lyra-organization-customer-${input.organizationId}`
            : `lyra-customer-${input.userId}`,
      },
    );

    return { id: customer.id };
  }

  public async createCheckoutSession(input: CreateStripeCheckoutSessionInput): Promise<{ id: string; url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: input.mode,
      customer: input.customerId,
      line_items: [
        {
          price: input.priceId,
          quantity: 1,
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.userId,
      metadata: {
        user_id: input.userId,
        lyra_organization_id: input.organizationId ?? '',
        organization_id: input.organizationId ?? '',
        kind: input.mode === 'subscription' ? 'subscription' : 'credit_purchase',
        plan_code: input.planCode ?? '',
        package_code: input.packageCode ?? '',
      },
      subscription_data:
        input.mode === 'subscription'
          ? {
              metadata: {
                user_id: input.userId,
                lyra_organization_id: input.organizationId ?? '',
                organization_id: input.organizationId ?? '',
                plan_code: input.planCode ?? '',
              },
            }
          : undefined,
    });

    if (session.url === null) {
      throw new ValidationError('Stripe Checkout session URL is not available');
    }

    return {
      id: session.id,
      url: session.url,
    };
  }

  public async createCustomerPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });

    return { url: session.url };
  }

  public async createSubscriptionUpdatePortalSession(
    input: CreateStripeSubscriptionUpdatePortalSessionInput,
  ): Promise<{ id: string; url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
      flow_data: {
        type: 'subscription_update_confirm',
        after_completion: {
          type: 'redirect',
          redirect: {
            return_url: input.returnUrl,
          },
        },
        subscription_update_confirm: {
          subscription: input.subscriptionId,
          items: [
            {
              id: input.subscriptionItemId,
              price: input.priceId,
              quantity: input.quantity,
            },
          ],
        },
      },
    });

    return {
      id: session.id,
      url: session.url,
    };
  }

  public async constructWebhookEvent(payload: Buffer, signature: string): Promise<Stripe.Event> {
    return await this.stripe.webhooks.constructEventAsync(payload, signature, this.webhookSecret);
  }

  public async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  public async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(
      subscriptionId,
      {},
      { idempotencyKey: `lyra-account-deletion-cancel-${subscriptionId}` },
    );
  }
}

export function getStripeSubscriptionPlanCode(
  subscription: Stripe.Subscription,
): SubscriptionPlanCode | null {
  const metadataPlanCode = subscription.metadata.plan_code;
  if (isSubscriptionPlanCode(metadataPlanCode)) {
    return metadataPlanCode;
  }

  return null;
}
