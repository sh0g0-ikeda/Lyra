import Stripe from 'stripe';
import {
  CREDIT_PACKAGE_DEFINITIONS,
  type ConsumerPaidPlanCode,
  type CreditPackageCode,
  type EnterprisePlanCode,
  type PaidPlanCode,
  type SubscriptionPlanCode,
  type SubscriptionStatus,
  getBillingPlanAmountJpy,
  getBillingPlanMonthlyCredits,
  isEnterprisePlanCode,
  isPaidPlanCode,
} from '../../domain/constants/billing.js';
import { ConfigurationError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { OrganizationStatus } from '../../domain/types/organization.js';
import type { StripeBillingClientPort } from '../../infrastructure/stripe/StripeBillingClient.js';
import type { DatabaseClient } from '../../lib/db.js';
import type { BillingRepository } from '../../repositories/BillingRepository.js';
import type { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { BillingCreditGrantServicePort } from '../credit/BillingCreditGrantService.js';
import type {
  BillingCreditAdjustmentServicePort,
  StripePaymentAdjustmentObservation,
} from '../credit/BillingCreditAdjustmentService.js';
import type { OrganizationServicePort } from '../organization/OrganizationService.js';

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
    private readonly organizationService: OrganizationServicePort,
    private readonly organizationRepository: OrganizationRepository,
    private readonly stripeClient: StripeBillingClientPort,
    private readonly config: StripeWebhookServiceConfig,
    private readonly billingCreditAdjustmentService: BillingCreditAdjustmentServicePort,
  ) {}

  public async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const event = await this.constructVerifiedWebhookEvent(rawBody, signature);

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
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleCustomerSubscriptionUpdated(event);
        return;
      case 'customer.subscription.deleted':
        await this.handleCustomerSubscriptionDeleted(event);
        return;
      case 'charge.refunded':
        await this.handleChargeRefunded(event);
        return;
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed':
        await this.handleRefundEvent(event);
        return;
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
        await this.handleDisputeEvent(event);
        return;
      default:
        await this.billingRepository.transaction(async (client) => {
          await this.billingRepository.markStripeEventProcessed(event.id, event.type, client);
        });
    }
  }

  private async constructVerifiedWebhookEvent(rawBody: Buffer, signature: string): Promise<Stripe.Event> {
    try {
      return await this.stripeClient.constructWebhookEvent(rawBody, signature);
    } catch {
      throw new ValidationError('Stripe webhook signature verification failed');
    }
  }

  private async handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = requireMetadataValue(session.metadata, 'user_id') ?? session.client_reference_id;
    const organizationId = requireOrganizationMetadataValue(session.metadata);
    const kind = requireMetadataValue(session.metadata, 'kind');
    const stripeCustomerId = typeof session.customer === 'string' ? session.customer : null;

    if (stripeCustomerId === null) {
      throw new ValidationError('Checkout session is missing customer');
    }

    if (organizationId !== null) {
      await this.handleOrganizationCheckoutSessionCompleted(
        event,
        session,
        organizationId,
        userId,
        kind,
        stripeCustomerId,
      );
      return;
    }

    if (userId === null) {
      throw new ValidationError('Checkout session is missing user_id');
    }
    if (await this.markPersonalEventProcessedIfDeleted(event, userId)) {
      return;
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
      const resolvedPlanCode = requireConsumerPaidPlanCode(this.resolvePlanCodeFromSubscription(subscription, planCode));
      const paidAmountJpy = session.amount_total ?? 0;
      const minimumAmountJpy = getBillingPlanAmountJpy(resolvedPlanCode);
      if (paidAmountJpy < minimumAmountJpy) {
        await this.recordUnderpaidCheckoutSession(event, {
          userId,
          stripeCustomerId,
          sessionId: session.id,
          kind: 'subscription',
          amountJpy: paidAmountJpy,
        });
        return;
      }

      await this.billingRepository.transaction(async (client) => {
        if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
          return;
        }

        await this.requireStripeCustomerBinding(userId, stripeCustomerId, client);
        await this.billingRepository.upsertSubscription(
          {
            userId,
            organizationId: null,
            stripeSubscriptionId,
            planCode: resolvedPlanCode,
            status: normalizeSubscriptionStatus(subscription.status),
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
            organizationId: null,
            stripeCheckoutSessionId: session.id,
            stripeInvoiceId: null,
            kind: 'subscription',
            amountJpy: session.amount_total ?? 0,
            status: session.payment_status === 'paid' ? 'paid' : 'failed',
            grantedCredits: getBillingPlanMonthlyCredits(resolvedPlanCode),
            creditBucket: 'monthly',
            grantExpiresAt: subscriptionCurrentPeriodEnd(subscription),
          },
          client,
        );
        if (paymentInserted) {
          await this.billingCreditGrantService.grantMonthlyCredits(
            {
              userId,
              amount: getBillingPlanMonthlyCredits(resolvedPlanCode),
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
      const paidAmountJpy = session.amount_total ?? 0;
      const minimumAmountJpy = CREDIT_PACKAGE_DEFINITIONS[packageCode].amountJpy;
      const stripePaymentIntentId = getStringIdentifier(session.payment_intent);
      const currency = session.currency?.toLowerCase() ?? null;
      if (stripePaymentIntentId === null || currency !== 'jpy') {
        throw new ValidationError('Credit purchase checkout is missing a JPY payment intent');
      }
      if (paidAmountJpy < minimumAmountJpy) {
        await this.recordUnderpaidCheckoutSession(event, {
          userId,
          stripeCustomerId,
          sessionId: session.id,
          kind: 'credit_purchase',
          amountJpy: paidAmountJpy,
        });
        return;
      }

      await this.billingRepository.transaction(async (client) => {
        if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
          return;
        }

        await this.requireStripeCustomerBinding(userId, stripeCustomerId, client);
        const paymentInserted = await this.billingRepository.insertPaymentRecord(
          {
            userId,
            organizationId: null,
            stripeCheckoutSessionId: session.id,
            stripeInvoiceId: null,
            kind: 'credit_purchase',
            amountJpy: session.amount_total ?? CREDIT_PACKAGE_DEFINITIONS[packageCode].amountJpy,
            status: session.payment_status === 'paid' ? 'paid' : 'failed',
            grantedCredits: CREDIT_PACKAGE_DEFINITIONS[packageCode].purchasedCredits,
            creditBucket: 'purchased',
            grantExpiresAt: null,
          },
          client,
        );
        await this.billingCreditAdjustmentService.registerCreditPurchase(
          {
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId,
            currency,
            grantedCredits: CREDIT_PACKAGE_DEFINITIONS[packageCode].purchasedCredits,
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
        await this.billingCreditAdjustmentService.settleScopeForPaymentIntent(stripePaymentIntentId, client);
      });

      return;
    }

    await this.billingRepository.transaction(async (client) => {
      await this.billingRepository.markStripeEventProcessed(event.id, event.type, client);
    });
  }

  private async handleOrganizationCheckoutSessionCompleted(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
    organizationId: string,
    actorUserId: string | null,
    kind: string | null,
    stripeCustomerId: string,
  ): Promise<void> {
    if (session.payment_status !== 'paid') {
      await this.markEventProcessedOnly(event);
      return;
    }

    if (kind === 'subscription') {
      const stripeSubscriptionId = getStringIdentifier(session.subscription);
      const planCode = requireEnterprisePlanCode(requireMetadataValue(session.metadata, 'plan_code'));
      if (stripeSubscriptionId === null) {
        throw new ValidationError('Subscription checkout session is missing subscription id');
      }

      const subscription = await this.stripeClient.retrieveSubscription(stripeSubscriptionId);
      const resolvedPlanCode = requireEnterprisePlanCode(this.resolvePlanCodeFromSubscription(subscription, planCode));
      const paidAmountJpy = session.amount_total ?? 0;
      const minimumAmountJpy = getBillingPlanAmountJpy(resolvedPlanCode);
      if (paidAmountJpy < minimumAmountJpy) {
        await this.recordUnderpaidCheckoutSession(event, {
          userId: actorUserId,
          organizationId,
          stripeCustomerId,
          sessionId: session.id,
          kind: 'subscription',
          amountJpy: paidAmountJpy,
        });
        return;
      }

      await this.billingRepository.transaction(async (client) => {
        if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
          return;
        }

        await this.requireStripeOrganizationBinding(organizationId, stripeCustomerId, client);
        await this.billingRepository.upsertSubscription(
          {
            userId: actorUserId,
            organizationId,
            stripeSubscriptionId,
            planCode: resolvedPlanCode,
            status: normalizeSubscriptionStatus(subscription.status),
            currentPeriodStart: subscriptionCurrentPeriodStart(subscription),
            currentPeriodEnd: subscriptionCurrentPeriodEnd(subscription),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          },
          client,
        );
        await this.requireOrganizationPlanUpdate(
          organizationId,
          resolvedPlanCode,
          organizationStatusForSubscriptionStatus(subscription.status),
          stripeSubscriptionId,
          client,
        );
        await this.insertOrganizationSubscriptionAudit(client, {
          organizationId,
          actorUserId,
          subscriptionId: stripeSubscriptionId,
          planCode: resolvedPlanCode,
          status: normalizeSubscriptionStatus(subscription.status),
          stripeEventId: event.id,
          source: event.type,
        });
        const paymentInserted = await this.billingRepository.insertPaymentRecord(
          {
            userId: actorUserId,
            organizationId,
            stripeCheckoutSessionId: session.id,
            stripeInvoiceId: null,
            kind: 'subscription',
            amountJpy: session.amount_total ?? 0,
            status: session.payment_status === 'paid' ? 'paid' : 'failed',
            grantedCredits: getBillingPlanMonthlyCredits(resolvedPlanCode),
            creditBucket: 'monthly',
            grantExpiresAt: subscriptionCurrentPeriodEnd(subscription),
          },
          client,
        );
        if (paymentInserted) {
          await this.organizationService.grantMonthlyCredits(
            {
              organizationId,
              actorUserId,
              amount: getBillingPlanMonthlyCredits(resolvedPlanCode),
              description: `Initial enterprise subscription grant for ${resolvedPlanCode}`,
              stripeEventId: event.id,
              expiresAt: subscriptionCurrentPeriodEnd(subscription),
            },
            client,
          );
        }
      });

      return;
    }

    if (kind === 'credit_purchase') {
      const packageCode = requireCreditPackageCode(requireMetadataValue(session.metadata, 'package_code'));
      const paidAmountJpy = session.amount_total ?? 0;
      const minimumAmountJpy = CREDIT_PACKAGE_DEFINITIONS[packageCode].amountJpy;
      const stripePaymentIntentId = getStringIdentifier(session.payment_intent);
      const currency = session.currency?.toLowerCase() ?? null;
      if (stripePaymentIntentId === null || currency !== 'jpy') {
        throw new ValidationError('Organization credit purchase checkout is missing a JPY payment intent');
      }
      if (paidAmountJpy < minimumAmountJpy) {
        await this.recordUnderpaidCheckoutSession(event, {
          userId: actorUserId,
          organizationId,
          stripeCustomerId,
          sessionId: session.id,
          kind: 'credit_purchase',
          amountJpy: paidAmountJpy,
        });
        return;
      }

      await this.billingRepository.transaction(async (client) => {
        if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
          return;
        }

        await this.requireStripeOrganizationBinding(organizationId, stripeCustomerId, client);
        const paymentInserted = await this.billingRepository.insertPaymentRecord(
          {
            userId: actorUserId,
            organizationId,
            stripeCheckoutSessionId: session.id,
            stripeInvoiceId: null,
            kind: 'credit_purchase',
            amountJpy: session.amount_total ?? CREDIT_PACKAGE_DEFINITIONS[packageCode].amountJpy,
            status: session.payment_status === 'paid' ? 'paid' : 'failed',
            grantedCredits: CREDIT_PACKAGE_DEFINITIONS[packageCode].purchasedCredits,
            creditBucket: 'purchased',
            grantExpiresAt: null,
          },
          client,
        );
        await this.billingCreditAdjustmentService.registerCreditPurchase(
          {
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId,
            currency,
            grantedCredits: CREDIT_PACKAGE_DEFINITIONS[packageCode].purchasedCredits,
          },
          client,
        );
        if (paymentInserted) {
          await this.organizationService.grantPurchasedCredits(
            {
              organizationId,
              actorUserId,
              amount: CREDIT_PACKAGE_DEFINITIONS[packageCode].purchasedCredits,
              description: `Stripe organization credit purchase for ${packageCode}`,
              stripeEventId: event.id,
              packageCode,
            },
            client,
          );
        }
        await this.billingCreditAdjustmentService.settleScopeForPaymentIntent(stripePaymentIntentId, client);
      });

      return;
    }

    await this.markEventProcessedOnly(event);
  }

  private async handleCheckoutSessionAsyncPaymentFailed(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = requireMetadataValue(session.metadata, 'user_id') ?? session.client_reference_id;
    const organizationId = requireOrganizationMetadataValue(session.metadata);
    const kind = requireMetadataValue(session.metadata, 'kind');
    const stripeCustomerId = typeof session.customer === 'string' ? session.customer : null;

    if ((userId === null && organizationId === null) || stripeCustomerId === null) {
      await this.markEventProcessedOnly(event);
      return;
    }

    const paymentRecordKind = checkoutPaymentRecordKind(kind);
    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      if (organizationId !== null) {
        await this.requireStripeOrganizationBinding(organizationId, stripeCustomerId, client);
      } else if (userId !== null) {
        const billingUser = await this.billingRepository.findBillingUserProfile(
          userId,
          client,
          true,
        );
        if (billingUser?.accountDeleted === true) {
          return;
        }
        await this.requireStripeCustomerBinding(userId, stripeCustomerId, client);
      }

      if (paymentRecordKind === null) {
        return;
      }

      await this.billingRepository.insertPaymentRecord(
        {
          userId,
          organizationId,
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

  private async recordUnderpaidCheckoutSession(
    event: Stripe.Event,
    input: {
      userId: string | null;
      organizationId?: string | null;
      stripeCustomerId: string;
      sessionId: string;
      kind: 'subscription' | 'credit_purchase';
      amountJpy: number;
    },
  ): Promise<void> {
    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      if (input.organizationId !== undefined && input.organizationId !== null) {
        await this.requireStripeOrganizationBinding(input.organizationId, input.stripeCustomerId, client);
      } else if (input.userId !== null) {
        await this.requireStripeCustomerBinding(input.userId, input.stripeCustomerId, client);
      }
      await this.billingRepository.insertPaymentRecord(
        {
          userId: input.userId,
          organizationId: input.organizationId ?? null,
          stripeCheckoutSessionId: input.sessionId,
          stripeInvoiceId: null,
          kind: input.kind,
          amountJpy: input.amountJpy,
          status: 'failed',
        },
        client,
      );
    });
  }

  private async recordUnderpaidSubscriptionInvoice(
    event: Stripe.Event,
    input: {
      userId: string | null;
      organizationId?: string | null;
      invoiceId: string;
      invoiceUrl?: string | null;
      amountJpy: number;
    },
  ): Promise<void> {
    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      await this.billingRepository.insertPaymentRecord(
        {
          userId: input.userId,
          organizationId: input.organizationId ?? null,
          stripeCheckoutSessionId: null,
          stripeInvoiceId: input.invoiceId,
          invoiceUrl: input.invoiceUrl ?? null,
          kind: 'subscription',
          amountJpy: input.amountJpy,
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

  private async handleChargeRefunded(event: Stripe.Event): Promise<void> {
    const charge = event.data.object as Stripe.Charge;
    await this.applyPaymentAdjustment(event, charge, {
      providerType: 'refund',
      providerObjectId: `charge:${charge.id}:refund-total`,
      status: 'succeeded',
      amountJpy: charge.amount_refunded,
      observedRefundedAmountJpy: charge.amount_refunded,
    });
  }

  private async handleRefundEvent(event: Stripe.Event): Promise<void> {
    const refund = event.data.object as Stripe.Refund;
    const charge = await this.retrieveCharge(refund.charge);
    await this.applyPaymentAdjustment(event, charge, {
      providerType: 'refund',
      providerObjectId: refund.id,
      status: stripeRefundAdjustmentStatus(refund.status),
      amountJpy: refund.amount,
      observedRefundedAmountJpy: charge.amount_refunded,
    });
  }

  private async handleDisputeEvent(event: Stripe.Event): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;
    const charge = await this.retrieveCharge(dispute.charge);
    await this.applyPaymentAdjustment(event, charge, {
      providerType: 'dispute',
      providerObjectId: dispute.id,
      status: stripeDisputeAdjustmentStatus(dispute.status),
      amountJpy: dispute.amount,
      observedRefundedAmountJpy: charge.amount_refunded,
    });
  }

  private async applyPaymentAdjustment(
    event: Stripe.Event,
    charge: Stripe.Charge,
    adjustment: Omit<
      StripePaymentAdjustmentObservation,
      'stripeEventId' | 'stripePaymentIntentId' | 'stripeChargeId' | 'currency'
    >,
  ): Promise<void> {
    const paymentIntentId = getStringIdentifier(charge.payment_intent);
    if (paymentIntentId === null) {
      throw new ValidationError('Stripe charge is missing payment_intent');
    }
    const service = this.billingCreditAdjustmentService;
    const observation: StripePaymentAdjustmentObservation = {
      ...adjustment,
      stripeEventId: event.id,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: charge.id,
      currency: charge.currency,
    };
    const resolution = await this.resolvePaymentAdjustmentTarget(charge, service);
    if (resolution.kind === 'no_credit_grant') {
      await this.markEventProcessedOnly(event);
      return;
    }
    if (resolution.kind === 'review_required') {
      await this.billingRepository.transaction(async (client) => {
        await service.recordUnresolvedObservation(
          { ...observation, externalId: resolution.externalId },
          client,
        );
      });
      throw new ConfigurationError('Stripe payment adjustment requires local billing reconciliation');
    }
    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) return;
      await service.applyObservation(observation, client);
    });
  }

  private async resolvePaymentAdjustmentTarget(
    charge: Stripe.Charge,
    service: BillingCreditAdjustmentServicePort,
  ): Promise<{ kind: 'linked' | 'no_credit_grant' } | {
    kind: 'review_required';
    externalId: { type: 'checkout'; id: string } | { type: 'invoice'; id: string };
  }> {
    const paymentIntentId = getStringIdentifier(charge.payment_intent);
    if (paymentIntentId === null) throw new ValidationError('Stripe charge is missing payment_intent');
    const linked = await this.billingRepository.transaction(
      async (client) => service.isPaymentLinked(paymentIntentId, client),
    );
    if (linked) return { kind: 'linked' };

    const checkoutFinder = this.stripeClient.findCheckoutSessionByPaymentIntent;
    const invoiceFinder = this.stripeClient.findInvoiceByPaymentIntent;
    if (checkoutFinder === undefined || invoiceFinder === undefined) {
      throw new ConfigurationError('Stripe payment recovery lookup is not configured');
    }
    const checkout = await checkoutFinder.call(this.stripeClient, paymentIntentId);
    if (checkout !== null) {
      assertProviderPaymentMatchesCharge(checkout, charge);
      const kind = requireMetadataValue(checkout.metadata, 'kind');
      if (kind !== 'credit_purchase' && kind !== 'subscription') {
        throw new ValidationError('Stripe checkout payment kind is invalid');
      }
      const packageCode = kind === 'credit_purchase'
        ? requireCreditPackageCode(requireMetadataValue(checkout.metadata, 'package_code'))
        : null;
      if (packageCode !== null && charge.amount < CREDIT_PACKAGE_DEFINITIONS[packageCode].amountJpy) {
        throw new ValidationError('Stripe checkout payment is below the configured credit package price');
      }
      const externalId = { type: 'checkout' as const, id: checkout.id };
      const outcome = await this.billingRepository.transaction((client) => service.linkExistingPayment(
        {
          externalId,
          stripePaymentIntentId: paymentIntentId,
          currency: charge.currency,
          expectedAmountJpy: charge.amount,
          expectedKind: kind,
          ...(packageCode === null ? {} : {
            fallbackGrant: {
              creditBucket: 'purchased' as const,
              grantedCredits: CREDIT_PACKAGE_DEFINITIONS[packageCode].purchasedCredits,
              grantExpiresAt: null,
            },
          }),
        },
        client,
      ));
      if (outcome === 'linked' || outcome === 'no_credit_grant') return { kind: outcome };
      if (outcome === 'review_required') return { kind: outcome, externalId };
    }

    const invoice = await invoiceFinder.call(this.stripeClient, paymentIntentId);
    if (invoice !== null) {
      assertProviderPaymentMatchesCharge(invoice, charge);
      const externalId = { type: 'invoice' as const, id: invoice.id };
      const outcome = await this.billingRepository.transaction((client) => service.linkExistingPayment(
        {
          externalId,
          stripePaymentIntentId: paymentIntentId,
          currency: charge.currency,
          expectedAmountJpy: charge.amount,
          expectedKind: 'subscription',
        },
        client,
      ));
      if (outcome === 'linked' || outcome === 'no_credit_grant') return { kind: outcome };
      if (outcome === 'review_required') return { kind: outcome, externalId };
    }
    throw new NotFoundError('Stripe payment adjustment does not match a local payment record');
  }

  private async retrieveCharge(charge: string | Stripe.Charge | null): Promise<Stripe.Charge> {
    if (charge !== null && typeof charge !== 'string' && !('deleted' in charge)) return charge;
    const chargeId = typeof charge === 'string' ? charge : null;
    if (chargeId === null) throw new ValidationError('Stripe adjustment is missing charge');
    const retrieveCharge = this.stripeClient.retrieveCharge;
    if (retrieveCharge === undefined) throw new ConfigurationError('Stripe charge retrieval is not configured');
    return retrieveCharge.call(this.stripeClient, chargeId);
  }

  private async markPersonalEventProcessedIfDeleted(
    event: Stripe.Event,
    userId: string,
  ): Promise<boolean> {
    return this.billingRepository.transaction(async (client) => {
      const billingUser = await this.billingRepository.findBillingUserProfile(
        userId,
        client,
        true,
      );
      if (billingUser?.accountDeleted !== true) {
        return false;
      }
      await this.billingRepository.markStripeEventProcessed(
        event.id,
        event.type,
        client,
      );
      return true;
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
    const resolvedPlanCode = this.resolvePlanCodeFromSubscription(subscription);
    const organizationId = requireOrganizationMetadataValue(subscription.metadata);
    if (organizationId !== null) {
      await this.handleOrganizationInvoicePaid(
        event,
        invoice,
        subscription,
        organizationId,
        stripeSubscriptionId,
        resolvedPlanCode,
      );
      return;
    }
    const planCode = requireConsumerPaidPlanCode(resolvedPlanCode);
    const billingUser = await this.billingRepository.findBillingUserProfileByStripeCustomerId(stripeCustomerId);

    if (billingUser === null) {
      throw new NotFoundError('Billing user not found for Stripe customer');
    }
    if (billingUser.accountDeleted === true) {
      await this.markEventProcessedOnly(event);
      return;
    }

    const paidAmountJpy = invoice.amount_paid;
    const minimumAmountJpy = getBillingPlanAmountJpy(planCode);
    if (requiresFullSubscriptionInvoiceAmount(invoice.billing_reason) && paidAmountJpy < minimumAmountJpy) {
      await this.recordUnderpaidSubscriptionInvoice(event, {
        userId: billingUser.userId,
        invoiceId: invoice.id,
        invoiceUrl: getStripeInvoiceHostedUrl(invoice),
        amountJpy: paidAmountJpy,
      });
      return;
    }

    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }
      const lockedBillingUser =
        await this.billingRepository.findBillingUserProfile(
          billingUser.userId,
          client,
          true,
        );
      if (lockedBillingUser?.accountDeleted === true) {
        return;
      }

      await this.billingRepository.upsertSubscription(
          {
          userId: billingUser.userId,
          organizationId: null,
          stripeSubscriptionId,
          planCode,
          status: normalizeSubscriptionStatus(subscription.status),
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
          organizationId: null,
          stripeCheckoutSessionId: null,
          stripeInvoiceId: invoice.id,
          invoiceUrl: getStripeInvoiceHostedUrl(invoice),
          kind: 'subscription',
          amountJpy: invoice.amount_paid,
          status: 'paid',
          grantedCredits: shouldGrantMonthlyCreditsForPaidInvoice(invoice.billing_reason, paidAmountJpy)
            ? getBillingPlanMonthlyCredits(planCode)
            : 0,
          creditBucket: shouldGrantMonthlyCreditsForPaidInvoice(invoice.billing_reason, paidAmountJpy)
            ? 'monthly'
            : null,
          grantExpiresAt: shouldGrantMonthlyCreditsForPaidInvoice(invoice.billing_reason, paidAmountJpy)
            ? subscriptionCurrentPeriodEnd(subscription)
            : null,
        },
        client,
      );

      if (shouldGrantMonthlyCreditsForPaidInvoice(invoice.billing_reason, paidAmountJpy) && paymentInserted) {
        await this.billingCreditGrantService.grantMonthlyCredits(
          {
            userId: billingUser.userId,
            amount: getBillingPlanMonthlyCredits(planCode),
            description:
              invoice.billing_reason === 'subscription_update'
                ? `Subscription plan change grant for ${planCode}`
                : `Monthly subscription renewal grant for ${planCode}`,
            expiresAt: subscriptionCurrentPeriodEnd(subscription),
            stripeEventId: event.id,
          },
          client,
        );
      }
    });
  }

  private async handleOrganizationInvoicePaid(
    event: Stripe.Event,
    invoice: Stripe.Invoice,
    subscription: Stripe.Subscription,
    organizationId: string,
    stripeSubscriptionId: string,
    planCode: PaidPlanCode,
  ): Promise<void> {
    const enterprisePlanCode = requireEnterprisePlanCode(planCode);
    const actorUserId = requireMetadataValue(subscription.metadata, 'user_id');
    const paidAmountJpy = invoice.amount_paid;
    const minimumAmountJpy = getBillingPlanAmountJpy(enterprisePlanCode);
    if (requiresFullSubscriptionInvoiceAmount(invoice.billing_reason) && paidAmountJpy < minimumAmountJpy) {
      await this.recordUnderpaidSubscriptionInvoice(event, {
        userId: actorUserId,
        organizationId,
        invoiceId: invoice.id,
        invoiceUrl: getStripeInvoiceHostedUrl(invoice),
        amountJpy: paidAmountJpy,
      });
      return;
    }

    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      await this.billingRepository.upsertSubscription(
        {
          userId: actorUserId,
          organizationId,
          stripeSubscriptionId,
          planCode: enterprisePlanCode,
          status: normalizeSubscriptionStatus(subscription.status),
          currentPeriodStart: subscriptionCurrentPeriodStart(subscription),
          currentPeriodEnd: subscriptionCurrentPeriodEnd(subscription),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        client,
      );
      await this.requireOrganizationPlanUpdate(
        organizationId,
        enterprisePlanCode,
        organizationStatusForSubscriptionStatus(subscription.status),
        stripeSubscriptionId,
        client,
      );
      await this.insertOrganizationSubscriptionAudit(client, {
        organizationId,
        actorUserId,
        subscriptionId: stripeSubscriptionId,
        planCode: enterprisePlanCode,
        status: subscription.status,
        stripeEventId: event.id,
        source: event.type,
      });

      const paymentInserted = await this.billingRepository.insertPaymentRecord(
        {
          userId: actorUserId,
          organizationId,
          stripeCheckoutSessionId: null,
          stripeInvoiceId: invoice.id,
          invoiceUrl: getStripeInvoiceHostedUrl(invoice),
          kind: 'subscription',
          amountJpy: invoice.amount_paid,
          status: 'paid',
          grantedCredits: shouldGrantMonthlyCreditsForPaidInvoice(invoice.billing_reason, paidAmountJpy)
            ? getBillingPlanMonthlyCredits(enterprisePlanCode)
            : 0,
          creditBucket: shouldGrantMonthlyCreditsForPaidInvoice(invoice.billing_reason, paidAmountJpy)
            ? 'monthly'
            : null,
          grantExpiresAt: shouldGrantMonthlyCreditsForPaidInvoice(invoice.billing_reason, paidAmountJpy)
            ? subscriptionCurrentPeriodEnd(subscription)
            : null,
        },
        client,
      );

      if (shouldGrantMonthlyCreditsForPaidInvoice(invoice.billing_reason, paidAmountJpy) && paymentInserted) {
        await this.organizationService.grantMonthlyCredits(
          {
            organizationId,
            actorUserId,
            amount: getBillingPlanMonthlyCredits(enterprisePlanCode),
            description:
              invoice.billing_reason === 'subscription_update'
                ? `Enterprise subscription plan change grant for ${enterprisePlanCode}`
                : `Enterprise monthly subscription renewal grant for ${enterprisePlanCode}`,
            stripeEventId: event.id,
            expiresAt: subscriptionCurrentPeriodEnd(subscription),
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
    const organizationSubscription =
      stripeSubscriptionId === null
        ? null
        : await this.resolveOrganizationSubscriptionFromStripe(stripeSubscriptionId);

    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      if (organizationSubscription !== null) {
        await this.billingRepository.upsertSubscription(
          {
            userId: organizationSubscription.actorUserId,
            organizationId: organizationSubscription.organizationId,
            stripeSubscriptionId: organizationSubscription.subscription.id,
            planCode: organizationSubscription.planCode,
            status: normalizeSubscriptionStatus(organizationSubscription.subscription.status),
            currentPeriodStart: subscriptionCurrentPeriodStart(organizationSubscription.subscription),
            currentPeriodEnd: subscriptionCurrentPeriodEnd(organizationSubscription.subscription),
            cancelAtPeriodEnd: organizationSubscription.subscription.cancel_at_period_end,
          },
          client,
        );
        await this.requireOrganizationPlanUpdate(
          organizationSubscription.organizationId,
          organizationSubscription.planCode,
          'past_due',
          organizationSubscription.subscription.id,
          client,
        );
        await this.insertOrganizationSubscriptionAudit(client, {
          organizationId: organizationSubscription.organizationId,
          actorUserId: organizationSubscription.actorUserId,
          subscriptionId: organizationSubscription.subscription.id,
          planCode: organizationSubscription.planCode,
          status: organizationSubscription.subscription.status,
          stripeEventId: event.id,
          source: event.type,
        });
        await this.billingRepository.insertPaymentRecord(
          {
            userId: organizationSubscription.actorUserId,
            organizationId: organizationSubscription.organizationId,
            stripeCheckoutSessionId: null,
            stripeInvoiceId: invoice.id,
            invoiceUrl: getStripeInvoiceHostedUrl(invoice),
            kind: 'subscription',
            amountJpy: invoice.amount_due,
            status: 'failed',
          },
          client,
        );
        return;
      }

      if (stripeCustomerId === null) {
        return;
      }

      const billingUser = await this.billingRepository.findBillingUserProfileByStripeCustomerId(
        stripeCustomerId,
        client,
        true,
      );
      if (billingUser === null) {
        return;
      }
      if (billingUser.accountDeleted === true) {
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
          organizationId: null,
          stripeCheckoutSessionId: null,
          stripeInvoiceId: invoice.id,
          invoiceUrl: getStripeInvoiceHostedUrl(invoice),
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
    const organizationId = requireOrganizationMetadataValue(subscription.metadata);

    if (organizationId !== null) {
      await this.handleOrganizationSubscriptionUpdated(event, subscription, organizationId);
      return;
    }

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
    if (billingUser.accountDeleted === true) {
      await this.markEventProcessedOnly(event);
      return;
    }

    const planCode = requireConsumerPaidPlanCode(this.resolvePlanCodeFromSubscription(subscription));

    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }
      const lockedBillingUser =
        await this.billingRepository.findBillingUserProfile(
          billingUser.userId,
          client,
          true,
        );
      if (lockedBillingUser?.accountDeleted === true) {
        return;
      }

      await this.billingRepository.upsertSubscription(
        {
          userId: billingUser.userId,
          organizationId: null,
          stripeSubscriptionId: subscription.id,
          planCode,
          status: normalizeSubscriptionStatus(subscription.status),
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
    const organizationId = requireOrganizationMetadataValue(subscription.metadata);

    if (organizationId !== null) {
      await this.handleOrganizationSubscriptionDeleted(event, subscription, organizationId);
      return;
    }

    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      await this.billingRepository.markSubscriptionDeleted(subscription.id, client);

      if (stripeCustomerId === null) {
        return;
      }

      const billingUser = await this.billingRepository.findBillingUserProfileByStripeCustomerId(
        stripeCustomerId,
        client,
        true,
      );
      if (billingUser === null) {
        return;
      }
      if (billingUser.accountDeleted === true) {
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

  private async handleOrganizationSubscriptionUpdated(
    event: Stripe.Event,
    subscription: Stripe.Subscription,
    organizationId: string,
  ): Promise<void> {
    const planCode = requireEnterprisePlanCode(this.resolvePlanCodeFromSubscription(subscription));
    const actorUserId = requireMetadataValue(subscription.metadata, 'user_id');

    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      await this.billingRepository.upsertSubscription(
        {
          userId: actorUserId,
          organizationId,
          stripeSubscriptionId: subscription.id,
          planCode,
          status: normalizeSubscriptionStatus(subscription.status),
          currentPeriodStart: subscriptionCurrentPeriodStart(subscription),
          currentPeriodEnd: subscriptionCurrentPeriodEnd(subscription),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        client,
      );
      await this.requireOrganizationPlanUpdate(
        organizationId,
        planCode,
        organizationStatusForSubscriptionStatus(subscription.status),
        subscription.id,
        client,
      );
      await this.insertOrganizationSubscriptionAudit(client, {
        organizationId,
        actorUserId,
        subscriptionId: subscription.id,
        planCode,
        status: subscription.status,
        stripeEventId: event.id,
        source: event.type,
      });
    });
  }

  private async handleOrganizationSubscriptionDeleted(
    event: Stripe.Event,
    subscription: Stripe.Subscription,
    organizationId: string,
  ): Promise<void> {
    await this.billingRepository.transaction(async (client) => {
      if (!(await this.billingRepository.markStripeEventProcessed(event.id, event.type, client))) {
        return;
      }

      await this.billingRepository.markSubscriptionDeleted(subscription.id, client);
      await this.requireOrganizationStatusUpdate(organizationId, 'canceled', client);
      await this.insertOrganizationSubscriptionAudit(client, {
        organizationId,
        actorUserId: requireMetadataValue(subscription.metadata, 'user_id'),
        subscriptionId: subscription.id,
        planCode: requireEnterprisePlanCode(this.resolvePlanCodeFromSubscription(subscription)),
        status: 'canceled',
        stripeEventId: event.id,
        source: event.type,
      });
    });
  }

  private async insertOrganizationSubscriptionAudit(
    client: DatabaseClient,
    input: {
      organizationId: string;
      actorUserId: string | null;
      subscriptionId: string;
      planCode: EnterprisePlanCode;
      status: string;
      stripeEventId: string;
      source: string;
    },
  ): Promise<void> {
    await this.organizationRepository.insertAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'subscription.updated',
        targetType: 'subscription',
        targetId: null,
        metadata: {
          stripe_subscription_id: input.subscriptionId,
          plan_code: input.planCode,
          status: input.status,
          stripe_event_id: input.stripeEventId,
          source: input.source,
        },
      },
      client,
    );
  }

  private async resolveOrganizationSubscriptionFromStripe(
    stripeSubscriptionId: string,
  ): Promise<{
    subscription: Stripe.Subscription;
    organizationId: string;
    actorUserId: string | null;
    planCode: EnterprisePlanCode;
  } | null> {
    const subscription = await this.stripeClient.retrieveSubscription(stripeSubscriptionId);
    const organizationId = requireOrganizationMetadataValue(subscription.metadata);
    if (organizationId === null) {
      return null;
    }

    return {
      subscription,
      organizationId,
      actorUserId: requireMetadataValue(subscription.metadata, 'user_id'),
      planCode: requireEnterprisePlanCode(this.resolvePlanCodeFromSubscription(subscription)),
    };
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
    const firstItemPriceId = subscription.items.data[0]?.price.id;
    if (firstItemPriceId !== undefined) {
      const planCode = this.config.subscriptionPlanByPriceId[firstItemPriceId];
      if (planCode !== undefined) {
        return planCode;
      }
    }

    const metadataPlanCode = subscription.metadata.plan_code;
    if (isPaidPlanCode(metadataPlanCode)) {
      return metadataPlanCode;
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

  private async requireStripeOrganizationBinding(
    organizationId: string,
    stripeCustomerId: string,
    client: DatabaseClient,
  ): Promise<void> {
    const organization = await this.organizationRepository.findOrganizationById(organizationId, client);
    if (organization === null) {
      throw new NotFoundError('Organization not found while binding Stripe customer');
    }

    if (organization.stripeCustomerId !== null && organization.stripeCustomerId !== stripeCustomerId) {
      throw new ValidationError('Stripe customer does not match organization');
    }

    if (organization.stripeCustomerId === null) {
      const updated = await this.organizationRepository.updateOrganization(
        organizationId,
        { stripeCustomerId },
        client,
      );
      if (updated === null || updated.stripeCustomerId !== stripeCustomerId) {
        throw new NotFoundError('Organization not found while binding Stripe customer');
      }
    }
  }

  private async requireOrganizationPlanUpdate(
    organizationId: string,
    planCode: EnterprisePlanCode,
    status: OrganizationStatus,
    stripeSubscriptionId: string,
    client: DatabaseClient,
  ): Promise<void> {
    const updated = await this.organizationRepository.updateOrganization(
      organizationId,
      {
        planKey: planCode,
        status,
        stripeSubscriptionId,
      },
      client,
    );
    if (updated === null) {
      throw new NotFoundError('Organization not found while updating billing plan');
    }
  }

  private async requireOrganizationStatusUpdate(
    organizationId: string,
    status: OrganizationStatus,
    client: DatabaseClient,
  ): Promise<void> {
    const updated = await this.organizationRepository.updateOrganization(
      organizationId,
      { status },
      client,
    );
    if (updated === null) {
      throw new NotFoundError('Organization not found while updating billing status');
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

function requireOrganizationMetadataValue(metadata: Record<string, string> | null | undefined): string | null {
  return requireMetadataValue(metadata, 'lyra_organization_id') ?? requireMetadataValue(metadata, 'organization_id');
}

function getStringIdentifier(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (value !== null && value !== undefined && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }

  return null;
}

function assertProviderPaymentMatchesCharge(
  payment: Stripe.Checkout.Session | Stripe.Invoice,
  charge: Stripe.Charge,
): void {
  const paymentIntentId = getStringIdentifier(charge.payment_intent);
  const chargeCustomerId = getStringIdentifier(charge.customer);
  const paymentCustomerId = getStringIdentifier(payment.customer);
  const amountJpy = payment.object === 'checkout.session' ? payment.amount_total : payment.amount_paid;
  if (
    paymentIntentId === null
    || chargeCustomerId === null
    || paymentCustomerId !== chargeCustomerId
    || payment.currency?.toLowerCase() !== charge.currency.toLowerCase()
    || amountJpy !== charge.amount
    || (payment.object === 'checkout.session' && getStringIdentifier(payment.payment_intent) !== paymentIntentId)
  ) {
    throw new ValidationError('Stripe payment lookup does not match the verified charge');
  }
}

function stripeRefundAdjustmentStatus(status: string | null): 'pending' | 'succeeded' | 'failed' {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'canceled') return 'failed';
  return 'pending';
}

function stripeDisputeAdjustmentStatus(status: Stripe.Dispute.Status): 'open' | 'won' | 'lost' {
  if (status === 'won') return 'won';
  if (status === 'lost') return 'lost';
  return 'open';
}

function getStripeInvoiceHostedUrl(invoice: Stripe.Invoice): string | null {
  return typeof invoice.hosted_invoice_url === 'string' && invoice.hosted_invoice_url.length > 0
    ? invoice.hosted_invoice_url
    : null;
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

function requiresFullSubscriptionInvoiceAmount(billingReason: Stripe.Invoice.BillingReason | null): boolean {
  return billingReason === 'subscription_cycle' || billingReason === 'subscription_create';
}

function shouldGrantMonthlyCreditsForPaidInvoice(
  billingReason: Stripe.Invoice.BillingReason | null,
  amountPaidJpy: number,
): boolean {
  if (billingReason === 'subscription_cycle') {
    return true;
  }

  // Stripe invoices for immediate plan upgrades are prorated. They can be lower
  // than the full monthly price, but still represent a paid move to the new plan.
  return billingReason === 'subscription_update' && amountPaidJpy > 0;
}

function requirePaidPlanCode(value: string | null): PaidPlanCode {
  if (isPaidPlanCode(value)) {
    return value;
  }

  throw new ValidationError('Stripe metadata plan_code is invalid');
}

function requireConsumerPaidPlanCode(value: PaidPlanCode): ConsumerPaidPlanCode {
  if (!isEnterprisePlanCode(value)) {
    return value;
  }

  throw new ValidationError('Enterprise Stripe event must include lyra_organization_id');
}

function requireEnterprisePlanCode(value: string | null): EnterprisePlanCode;
function requireEnterprisePlanCode(value: PaidPlanCode): EnterprisePlanCode;
function requireEnterprisePlanCode(value: string | null): EnterprisePlanCode {
  if (typeof value === 'string' && isEnterprisePlanCode(value)) {
    return value;
  }

  throw new ValidationError('Stripe metadata enterprise plan_code is invalid');
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

function organizationStatusForSubscriptionStatus(status: Stripe.Subscription.Status): OrganizationStatus {
  if (status === 'active' || status === 'trialing') {
    return status === 'active' ? 'active' : 'trialing';
  }

  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') {
    return 'past_due';
  }

  return 'canceled';
}

function normalizeSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case 'active':
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    case 'past_due':
    case 'paused':
    case 'trialing':
    case 'unpaid':
      return status as SubscriptionStatus;
    default:
      return 'incomplete';
  }
}
