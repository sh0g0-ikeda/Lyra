import Stripe from 'stripe';
import {
  CREDIT_PACKAGE_DEFINITIONS,
  SUBSCRIPTION_PLAN_DEFINITIONS,
  type CreditPackageCode,
  type PaidPlanCode,
  type SubscriptionPlanCode,
} from '../../domain/constants/billing.js';
import { ConfigurationError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { StripeBillingClientPort } from '../../infrastructure/stripe/StripeBillingClient.js';
import type { DatabaseClient } from '../../lib/db.js';
import type { BillingRepository } from '../../repositories/BillingRepository.js';
import type { BillingCreditGrantServicePort } from '../credit/BillingCreditGrantService.js';

export interface StripeWebhookServicePort {
  handleWebhook(rawBody: Buffer, signature: string): Promise<void>;
}

export interface StripeWebhookServiceConfig {
  subscriptionPlanByPriceId: Record<string, PaidPlanCode>;
}

export class StripeWebhookService implements StripeWebhookServicePort {
  public constructor(
    private readonly billingRepository: BillingRepository,
    private readonly billingCreditGrantService: BillingCreditGrantServicePort,
    private readonly stripeClient: StripeBillingClientPort,
    private readonly config: StripeWebhookServiceConfig,
  ) {}

  public async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const event = this.constructVerifiedWebhookEvent(rawBody, signature);

    if (await this.billingRepository.hasStripeEventProcessed(event.id)) {
      return;
    }

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await this.handleCheckoutSessionCompleted(event);
        return;
      case 'checkout.session.async_payment_failed':
        await this.handleCheckoutSessionAsyncPaymentFailed(event);
        return;
      case 'invoice.paid':
        await this.handleInvoicePaid(event);
        return;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event);
        return;
      case 'customer.subscription.updated':
        await this.handleCustomerSubscriptionUpdated(event);
        return;
      case 'customer.subscription.deleted':
        await this.handleCustomerSubscriptionDeleted(event);
        return;
      default:
        await this.billingRepository.transaction(async (client) => {
          await this.billingRepository.markStripeEventProcessed(event.id, event.type, client);
        });
    }
  }

  private constructVerifiedWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    try {
      return this.stripeClient.constructWebhookEvent(rawBody, signature);
    } catch {
      throw new ValidationError('Stripe webhook signature verification failed');
    }
  }

  private async handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = requireMetadataValue(session.metadata, 'user_id') ?? session.client_reference_id;
    const kind = requireMetadataValue(session.metadata, 'kind');
    const stripeCustomerId = typeof session.customer === 'string' ? session.customer : null;

    if (userId === null || stripeCustomerId === null) {
      throw new ValidationError('Checkout session is missing user_id or customer');
    }

    if (session.payment_status !== 'paid') {
      await this.markEventProcessedOnly(event);
      return;
    }

    if (kind === 'subscription') {
      const stripeSubscriptionId = getStringIdentifier(session.subscription);
      const planCode = requirePaidPlanCode(requireMetadataValue(session.metadata, 'plan_code'));
      if (stripeSubscriptionId === null) {
        throw new ValidationError('Subscription checkout session is missing subscription id');
      }

      const subscription = await this.stripeClient.retrieveSubscription(stripeSubscriptionId);
      const resolvedPlanCode = this.resolvePlanCodeFromSubscription(subscription, planCode);

      await this.billingRepository.transaction(async (client) => {
        if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
          return;
        }

        await this.requireStripeCustomerBinding(userId, stripeCustomerId, client);
        await this.billingRepository.upsertSubscription(
          {
            userId,
            stripeSubscriptionId,
            planCode: resolvedPlanCode,
            status: subscription.status,
            currentPeriodStart: subscriptionCurrentPeriodStart(subscription),
            currentPeriodEnd: subscriptionCurrentPeriodEnd(subscription),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          },
          client,
        );
        await this.requirePlanUpdate(userId, resolvedPlanCode, client);
        const paymentInserted = await this.billingRepository.insertPaymentRecord(
          {
            userId,
            stripeCheckoutSessionId: session.id,
            stripeInvoiceId: null,
            kind: 'subscription',
            amountJpy: session.amount_total ?? 0,
            status: session.payment_status === 'paid' ? 'paid' : 'failed',
          },
          client,
        );
        if (paymentInserted) {
          await this.billingCreditGrantService.grantMonthlyCredits(
            {
              userId,
              amount: SUBSCRIPTION_PLAN_DEFINITIONS[resolvedPlanCode].monthlyCredits,
              description: `Initial monthly subscription grant for ${resolvedPlanCode}`,
              expiresAt: subscriptionCurrentPeriodEnd(subscription),
              stripeEventId: event.id,
            },
            client,
          );
        }
      });

      return;
    }

    if (kind === 'credit_purchase') {
      const packageCode = requireCreditPackageCode(requireMetadataValue(session.metadata, 'package_code'));

      await this.billingRepository.transaction(async (client) => {
        if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
          return;
        }

        await this.requireStripeCustomerBinding(userId, stripeCustomerId, client);
        const paymentInserted = await this.billingRepository.insertPaymentRecord(
          {
            userId,
            stripeCheckoutSessionId: session.id,
            stripeInvoiceId: null,
            kind: 'credit_purchase',
            amountJpy: session.amount_total ?? CREDIT_PACKAGE_DEFINITIONS[packageCode].amountJpy,
            status: session.payment_status === 'paid' ? 'paid' : 'failed',
          },
          client,
        );
        if (paymentInserted) {
          await this.billingCreditGrantService.grantPurchasedCredits(
            {
              userId,
              amount: CREDIT_PACKAGE_DEFINITIONS[packageCode].purchasedCredits,
              description: `Stripe credit purchase for ${packageCode}`,
              stripeEventId: event.id,
            },
            client,
          );
        }
      });

      return;
    }

    await this.billingRepository.transaction(async (client) => {
      await this.billingRepository.markStripeEventProcessed(event.id, event.type, client);
    });
  }

  private async handleCheckoutSessionAsyncPaymentFailed(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = requireMetadataValue(session.metadata, 'user_id') ?? session.client_reference_id;
    const kind = requireMetadataValue(session.metadata, 'kind');
    const stripeCustomerId = typeof session.customer === 'string' ? session.customer : null;

    if (userId === null || stripeCustomerId === null) {
      await this.markEventProcessedOnly(event);
      return;
    }

    const paymentRecordKind = checkoutPaymentRecordKind(kind);
    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      await this.requireStripeCustomerBinding(userId, stripeCustomerId, client);

      if (paymentRecordKind === null) {
        return;
      }

      await this.billingRepository.insertPaymentRecord(
        {
          userId,
          stripeCheckoutSessionId: session.id,
          stripeInvoiceId: null,
          kind: paymentRecordKind,
          amountJpy: session.amount_total ?? 0,
          status: 'failed',
        },
        client,
      );
    });
  }

  private async markEventProcessedOnly(event: Stripe.Event): Promise<void> {
    await this.billingRepository.transaction(async (client) => {
      await this.billingRepository.markStripeEventProcessed(event.id, event.type, client);
    });
  }

  private async handleInvoicePaid(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const stripeCustomerId = getStringIdentifier(invoice.customer);
    const stripeSubscriptionId = invoiceSubscriptionId(invoice);

    if (stripeCustomerId === null || stripeSubscriptionId === null) {
      await this.billingRepository.transaction(async (client) => {
        await this.billingRepository.markStripeEventProcessed(event.id, event.type, client);
      });
      return;
    }

    const subscription = await this.stripeClient.retrieveSubscription(stripeSubscriptionId);
    const planCode = this.resolvePlanCodeFromSubscription(subscription);
    const billingUser = await this.billingRepository.findBillingUserProfileByStripeCustomerId(stripeCustomerId);

    if (billingUser === null) {
      throw new NotFoundError('Billing user not found for Stripe customer');
    }

    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      await this.billingRepository.upsertSubscription(
        {
          userId: billingUser.userId,
          stripeSubscriptionId,
          planCode,
          status: subscription.status,
          currentPeriodStart: subscriptionCurrentPeriodStart(subscription),
          currentPeriodEnd: subscriptionCurrentPeriodEnd(subscription),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        client,
      );
      await this.requirePlanUpdate(billingUser.userId, planCode, client);

      const paymentInserted = await this.billingRepository.insertPaymentRecord(
        {
          userId: billingUser.userId,
          stripeCheckoutSessionId: null,
          stripeInvoiceId: invoice.id,
          kind: 'subscription',
          amountJpy: invoice.amount_paid,
          status: 'paid',
        },
        client,
      );

      if (invoice.billing_reason === 'subscription_cycle' && paymentInserted) {
        await this.billingCreditGrantService.grantMonthlyCredits(
          {
            userId: billingUser.userId,
            amount: SUBSCRIPTION_PLAN_DEFINITIONS[planCode].monthlyCredits,
            description: `Monthly subscription renewal grant for ${planCode}`,
            expiresAt: subscriptionCurrentPeriodEnd(subscription),
            stripeEventId: event.id,
          },
          client,
        );
      }
    });
  }

  private async handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const stripeCustomerId = getStringIdentifier(invoice.customer);
    const stripeSubscriptionId = invoiceSubscriptionId(invoice);

    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      if (stripeCustomerId === null) {
        return;
      }

      const billingUser = await this.billingRepository.findBillingUserProfileByStripeCustomerId(stripeCustomerId, client);
      if (billingUser === null) {
        return;
      }

      const nextPlanCode =
        stripeSubscriptionId === null
          ? 'free'
          : await this.resolveFallbackPlanAfterSubscriptionDeactivation(
              billingUser.userId,
              stripeSubscriptionId,
              client,
            );
      await this.requirePlanUpdate(billingUser.userId, nextPlanCode, client);
      await this.billingRepository.insertPaymentRecord(
        {
          userId: billingUser.userId,
          stripeCheckoutSessionId: null,
          stripeInvoiceId: invoice.id,
          kind: 'subscription',
          amountJpy: invoice.amount_due,
          status: 'failed',
        },
        client,
      );
    });
  }

  private async handleCustomerSubscriptionUpdated(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const stripeCustomerId = getStringIdentifier(subscription.customer);

    if (stripeCustomerId === null) {
      await this.billingRepository.transaction(async (client) => {
        await this.billingRepository.markStripeEventProcessed(event.id, event.type, client);
      });
      return;
    }

    const billingUser = await this.billingRepository.findBillingUserProfileByStripeCustomerId(stripeCustomerId);
    if (billingUser === null) {
      throw new NotFoundError('Billing user not found for Stripe customer');
    }

    const planCode = this.resolvePlanCodeFromSubscription(subscription);

    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      await this.billingRepository.upsertSubscription(
        {
          userId: billingUser.userId,
          stripeSubscriptionId: subscription.id,
          planCode,
          status: subscription.status,
          currentPeriodStart: subscriptionCurrentPeriodStart(subscription),
          currentPeriodEnd: subscriptionCurrentPeriodEnd(subscription),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        client,
      );

      const nextPlanCode =
        subscription.status === 'active' || subscription.status === 'trialing'
          ? planCode
          : await this.resolveFallbackPlanAfterSubscriptionDeactivation(
              billingUser.userId,
              subscription.id,
              client,
            );
      await this.requirePlanUpdate(billingUser.userId, nextPlanCode, client);
    });
  }

  private async handleCustomerSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const stripeCustomerId = getStringIdentifier(subscription.customer);

    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      await this.billingRepository.markSubscriptionDeleted(subscription.id, client);

      if (stripeCustomerId === null) {
        return;
      }

      const billingUser = await this.billingRepository.findBillingUserProfileByStripeCustomerId(stripeCustomerId, client);
      if (billingUser === null) {
        return;
      }

      const nextPlanCode = await this.resolveFallbackPlanAfterSubscriptionDeactivation(
        billingUser.userId,
        subscription.id,
        client,
      );
      await this.requirePlanUpdate(billingUser.userId, nextPlanCode, client);
    });
  }

  private async resolveFallbackPlanAfterSubscriptionDeactivation(
    userId: string,
    stripeSubscriptionId: string,
    client: DatabaseClient,
  ): Promise<SubscriptionPlanCode> {
    const activeSubscriptionPlan =
      await this.billingRepository.findHighestActiveSubscriptionPlanForUserExcluding(
        userId,
        stripeSubscriptionId,
        client,
      );

    return activeSubscriptionPlan ?? 'free';
  }

  private resolvePlanCodeFromSubscription(
    subscription: Stripe.Subscription,
    fallbackPlanCode?: PaidPlanCode,
  ): PaidPlanCode {
    const metadataPlanCode = subscription.metadata.plan_code;
    if (metadataPlanCode === 'standard' || metadataPlanCode === 'premium') {
      return metadataPlanCode;
    }

    const firstItemPriceId = subscription.items.data[0]?.price.id;
    if (firstItemPriceId !== undefined) {
      const planCode = this.config.subscriptionPlanByPriceId[firstItemPriceId];
      if (planCode !== undefined) {
        return planCode;
      }
    }

    if (fallbackPlanCode !== undefined) {
      return fallbackPlanCode;
    }

    throw new ConfigurationError('Unable to resolve subscription plan code from Stripe event');
  }

  private async requirePlanUpdate(
    userId: string,
    planCode: SubscriptionPlanCode,
    client: DatabaseClient,
  ): Promise<void> {
    const updated = await this.billingRepository.updateUserPlanCode(userId, planCode, client);
    if (!updated) {
      throw new NotFoundError('User not found while updating billing plan');
    }
  }

  private async requireStripeCustomerBinding(
    userId: string,
    stripeCustomerId: string,
    client: DatabaseClient,
  ): Promise<void> {
    const persistedStripeCustomerId = await this.billingRepository.setStripeCustomerId(
      userId,
      stripeCustomerId,
      client,
    );
    if (persistedStripeCustomerId === null) {
      throw new NotFoundError('User not found while binding Stripe customer');
    }

    if (persistedStripeCustomerId !== stripeCustomerId) {
      throw new ValidationError('Stripe customer does not match billing user');
    }
  }
}

function requireMetadataValue(
  metadata: Record<string, string> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return value === undefined || value.length === 0 ? null : value;
}

function getStringIdentifier(value: string | Stripe.DeletedCustomer | Stripe.Customer | Stripe.Subscription | null): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (value !== null && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }

  return null;
}

function unixToDate(value: number | null): Date | null {
  return value === null ? null : new Date(value * 1000);
}

function subscriptionCurrentPeriodStart(subscription: Stripe.Subscription): Date | null {
  return unixToDate(subscription.items.data[0]?.current_period_start ?? null);
}

function subscriptionCurrentPeriodEnd(subscription: Stripe.Subscription): Date | null {
  return unixToDate(subscription.items.data[0]?.current_period_end ?? null);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (parent === null || parent.type !== 'subscription_details' || parent.subscription_details === null) {
    return null;
  }

  return getStringIdentifier(parent.subscription_details.subscription);
}

function requirePaidPlanCode(value: string | null): PaidPlanCode {
  if (value === 'standard' || value === 'premium') {
    return value;
  }

  throw new ValidationError('Stripe metadata plan_code is invalid');
}

function requireCreditPackageCode(value: string | null): CreditPackageCode {
  if (value === 'credits_200' || value === 'credits_1000' || value === 'credits_3000') {
    return value;
  }

  throw new ValidationError('Stripe metadata package_code is invalid');
}

function checkoutPaymentRecordKind(value: string | null): 'subscription' | 'credit_purchase' | null {
  if (value === 'subscription' || value === 'credit_purchase') {
    return value;
  }

  return null;
}
