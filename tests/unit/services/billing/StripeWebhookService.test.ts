import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import type { PaidPlanCode, SubscriptionPlanCode } from '../../../../src/domain/constants/billing.js';
import type { BillingUserProfile, PaymentRecordInput, SubscriptionRecord } from '../../../../src/domain/types/billing.js';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type { StripeBillingClientPort } from '../../../../src/infrastructure/stripe/StripeBillingClient.js';
import type { DatabaseClient } from '../../../../src/lib/db.js';
import type { BillingRepository } from '../../../../src/repositories/BillingRepository.js';
import type {
  BillingCreditGrantServicePort,
  GrantMonthlyCreditsParams,
  GrantPurchasedCreditsParams,
} from '../../../../src/services/credit/BillingCreditGrantService.js';
import { StripeWebhookService } from '../../../../src/services/billing/StripeWebhookService.js';

class InMemoryBillingRepository implements BillingRepository {
  public processedEvents = new Set<string>();
  public userById = new Map<string, BillingUserProfile>();
  public userByCustomerId = new Map<string, BillingUserProfile>();
  public updatedPlans: Array<{ userId: string; planCode: string }> = [];
  public subscriptions: SubscriptionRecord[] = [];
  public deletedSubscriptions: string[] = [];
  public paymentRecords: PaymentRecordInput[] = [];
  public insertedCustomerIds: Array<{ userId: string; stripeCustomerId: string }> = [];

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work({ query: async () => ({ command: '', rowCount: 0, oid: 0, fields: [], rows: [] }) });
  }

  public async findBillingUserProfile(userId: string): Promise<BillingUserProfile | null> {
    return this.userById.get(userId) ?? null;
  }

  public async findBillingUserProfileByStripeCustomerId(stripeCustomerId: string): Promise<BillingUserProfile | null> {
    return this.userByCustomerId.get(stripeCustomerId) ?? null;
  }

  public async setStripeCustomerId(userId: string, stripeCustomerId: string): Promise<string | null> {
    this.insertedCustomerIds.push({ userId, stripeCustomerId });
    const current = this.userById.get(userId);
    if (current !== undefined) {
      const next = { ...current, stripeCustomerId };
      this.userById.set(userId, next);
      this.userByCustomerId.set(stripeCustomerId, next);
      return next.stripeCustomerId;
    }

    return stripeCustomerId;
  }

  public async updateUserPlanCode(userId: string, planCode: string): Promise<boolean> {
    this.updatedPlans.push({ userId, planCode });
    const current = this.userById.get(userId);
    if (current === undefined) {
      return false;
    }

    const next = { ...current, planCode: planCode as SubscriptionPlanCode };
    this.userById.set(userId, next);
    if (next.stripeCustomerId !== null) {
      this.userByCustomerId.set(next.stripeCustomerId, next);
    }

    return true;
  }

  public async markStripeEventProcessed(stripeEventId: string): Promise<boolean> {
    if (this.processedEvents.has(stripeEventId)) {
      return false;
    }

    this.processedEvents.add(stripeEventId);
    return true;
  }

  public async upsertSubscription(record: SubscriptionRecord): Promise<void> {
    this.subscriptions.push(record);
  }

  public async markSubscriptionDeleted(stripeSubscriptionId: string): Promise<void> {
    this.deletedSubscriptions.push(stripeSubscriptionId);
  }

  public async insertPaymentRecord(record: PaymentRecordInput): Promise<void> {
    this.paymentRecords.push(record);
  }
}

class FakeBillingCreditGrantService implements BillingCreditGrantServicePort {
  public monthlyGrants: GrantMonthlyCreditsParams[] = [];
  public purchasedGrants: GrantPurchasedCreditsParams[] = [];

  public async grantMonthlyCredits(
    params: GrantMonthlyCreditsParams,
    _client?: DatabaseClient,
  ): Promise<CreditBalanceSnapshot> {
    this.monthlyGrants.push(params);
    return {
      monthlyCredits: params.amount,
      purchasedCredits: 0,
      totalCredits: params.amount,
      monthlyExpiresAt: params.expiresAt,
    };
  }

  public async grantPurchasedCredits(
    params: GrantPurchasedCreditsParams,
    _client?: DatabaseClient,
  ): Promise<CreditBalanceSnapshot> {
    this.purchasedGrants.push(params);
    return {
      monthlyCredits: 0,
      purchasedCredits: params.amount,
      totalCredits: params.amount,
      monthlyExpiresAt: null,
    };
  }
}

class FakeStripeBillingClient implements StripeBillingClientPort {
  public event: Stripe.Event = buildCheckoutSubscriptionEvent();
  public subscription: Stripe.Subscription = buildSubscription();

  public async createCustomer(): Promise<never> {
    throw new Error('unused');
  }

  public async createCheckoutSession(): Promise<never> {
    throw new Error('unused');
  }

  public async createCustomerPortalSession(): Promise<never> {
    throw new Error('unused');
  }

  public constructWebhookEvent(): Stripe.Event {
    return this.event;
  }

  public async retrieveSubscription(): Promise<Stripe.Subscription> {
    return this.subscription;
  }
}

describe('StripeWebhookService', () => {
  it('checkout.session.completed の subscription で plan/subscription/monthly grant を反映する', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutSubscriptionEvent();
    stripeClient.subscription = buildSubscription();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.processedEvents.has('evt_checkout_sub')).toBe(true);
    expect(repository.insertedCustomerIds[0]).toEqual({
      userId: 'user-1',
      stripeCustomerId: 'cus_123',
    });
    expect(repository.subscriptions[0]).toMatchObject({
      stripeSubscriptionId: 'sub_123',
      planCode: 'standard',
      status: 'active',
    });
    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'standard' });
    expect(creditGrantService.monthlyGrants[0]).toMatchObject({
      userId: 'user-1',
      amount: 50,
      stripeEventId: 'evt_checkout_sub',
    });
    expect(repository.paymentRecords[0]).toMatchObject({
      kind: 'subscription',
      amountJpy: 1980,
      status: 'paid',
    });
  });

  it('checkout.session.completed の credit purchase で purchased grant を反映する', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutCreditPurchaseEvent();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(creditGrantService.purchasedGrants[0]).toMatchObject({
      userId: 'user-1',
      amount: 50,
      stripeEventId: 'evt_checkout_credit',
    });
    expect(repository.paymentRecords[0]).toMatchObject({
      kind: 'credit_purchase',
      amountJpy: 2250,
      status: 'paid',
    });
  });

  it('does not grant credits for unpaid checkout.session.completed events', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutCreditPurchaseEvent({
      id: 'evt_checkout_credit_unpaid',
      paymentStatus: 'unpaid',
    });
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.processedEvents.has('evt_checkout_credit_unpaid')).toBe(true);
    expect(creditGrantService.purchasedGrants).toHaveLength(0);
    expect(repository.paymentRecords).toHaveLength(0);
    expect(repository.updatedPlans).toHaveLength(0);
  });

  it('does not activate subscriptions for unpaid checkout.session.completed events', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutSubscriptionEvent({
      id: 'evt_checkout_sub_unpaid',
      paymentStatus: 'unpaid',
    });
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.processedEvents.has('evt_checkout_sub_unpaid')).toBe(true);
    expect(creditGrantService.monthlyGrants).toHaveLength(0);
    expect(repository.subscriptions).toHaveLength(0);
    expect(repository.updatedPlans).toHaveLength(0);
    expect(repository.paymentRecords).toHaveLength(0);
  });

  it('processes async checkout payment success through the paid checkout path', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutCreditPurchaseEvent({
      id: 'evt_checkout_credit_async_success',
      type: 'checkout.session.async_payment_succeeded',
      paymentStatus: 'paid',
    });
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(creditGrantService.purchasedGrants[0]).toMatchObject({
      userId: 'user-1',
      amount: 50,
      stripeEventId: 'evt_checkout_credit_async_success',
    });
    expect(repository.paymentRecords[0]).toMatchObject({
      kind: 'credit_purchase',
      amountJpy: 2250,
      status: 'paid',
    });
  });

  it('records async checkout payment failures without granting credits', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutCreditPurchaseEvent({
      id: 'evt_checkout_credit_async_failed',
      type: 'checkout.session.async_payment_failed',
      paymentStatus: 'unpaid',
    });
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.processedEvents.has('evt_checkout_credit_async_failed')).toBe(true);
    expect(creditGrantService.purchasedGrants).toHaveLength(0);
    expect(repository.paymentRecords[0]).toMatchObject({
      stripeCheckoutSessionId: 'cs_pay_123',
      kind: 'credit_purchase',
      amountJpy: 2250,
      status: 'failed',
    });
  });

  it('invoice.paid の subscription_cycle で月次 grant を行う', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildInvoicePaidEvent('subscription_cycle');
    stripeClient.subscription = buildSubscription();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(creditGrantService.monthlyGrants).toHaveLength(1);
    expect(creditGrantService.monthlyGrants[0]?.stripeEventId).toBe('evt_invoice_paid');
    expect(repository.paymentRecords[0]).toMatchObject({
      stripeInvoiceId: 'in_123',
      status: 'paid',
    });
  });

  it('invoice.payment_failed で plan を free に降格する', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildInvoicePaymentFailedEvent();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'free' });
    expect(repository.paymentRecords[0]).toMatchObject({
      stripeInvoiceId: 'in_124',
      amountJpy: 1980,
      status: 'failed',
    });
  });

  it('customer.subscription.updated で portal 変更後の plan を同期する', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCustomerSubscriptionUpdatedEvent('price_premium');
    stripeClient.subscription = buildSubscription('premium', 'price_premium');
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.subscriptions[0]).toMatchObject({
      stripeSubscriptionId: 'sub_123',
      planCode: 'premium',
    });
    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'premium' });
  });

  it('customer.subscription.deleted で subscription を終了して free に戻す', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCustomerSubscriptionDeletedEvent();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.deletedSubscriptions).toEqual(['sub_123']);
    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'free' });
  });

  it('同じ event id は二重処理しない', async () => {
    const repository = seedRepository();
    repository.processedEvents.add('evt_checkout_credit');
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutCreditPurchaseEvent();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(creditGrantService.purchasedGrants).toHaveLength(0);
    expect(repository.paymentRecords).toHaveLength(0);
  });
});

function seedRepository(): InMemoryBillingRepository {
  const repository = new InMemoryBillingRepository();
  const billingUser: BillingUserProfile = {
    userId: 'user-1',
    email: 'user@example.com',
    stripeCustomerId: 'cus_123',
    planCode: 'free',
  };
  repository.userById.set('user-1', billingUser);
  repository.userByCustomerId.set('cus_123', billingUser);
  return repository;
}

function buildService(
  repository: BillingRepository,
  creditGrantService: BillingCreditGrantServicePort,
  stripeClient: StripeBillingClientPort,
): StripeWebhookService {
  return new StripeWebhookService(repository, creditGrantService, stripeClient, {
    subscriptionPlanByPriceId: {
      price_standard: 'standard',
      price_premium: 'premium',
    },
  });
}

function buildCheckoutSubscriptionEvent(options: {
  id?: string;
  paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required';
  type?: string;
} = {}): Stripe.Event {
  return {
    id: options.id ?? 'evt_checkout_sub',
    object: 'event',
    api_version: '2025-03-31',
    created: 1,
    data: {
      object: {
        id: 'cs_sub_123',
        object: 'checkout.session',
        customer: 'cus_123',
        subscription: 'sub_123',
        client_reference_id: 'user-1',
        metadata: {
          kind: 'subscription',
          user_id: 'user-1',
          plan_code: 'standard',
        },
        payment_status: options.paymentStatus ?? 'paid',
        amount_total: 1980,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: options.type ?? 'checkout.session.completed',
  } as unknown as Stripe.Event;
}

function buildCheckoutCreditPurchaseEvent(options: {
  id?: string;
  paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required';
  type?: string;
} = {}): Stripe.Event {
  return {
    id: options.id ?? 'evt_checkout_credit',
    object: 'event',
    api_version: '2025-03-31',
    created: 1,
    data: {
      object: {
        id: 'cs_pay_123',
        object: 'checkout.session',
        customer: 'cus_123',
        subscription: null,
        client_reference_id: 'user-1',
        metadata: {
          kind: 'credit_purchase',
          user_id: 'user-1',
          package_code: 'credits_1000',
        },
        payment_status: options.paymentStatus ?? 'paid',
        amount_total: 2250,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: options.type ?? 'checkout.session.completed',
  } as unknown as Stripe.Event;
}

function buildInvoicePaidEvent(billingReason: Stripe.Invoice.BillingReason): Stripe.Event {
  return {
    id: 'evt_invoice_paid',
    object: 'event',
    api_version: '2025-03-31',
    created: 1,
    data: {
      object: {
        id: 'in_123',
        object: 'invoice',
        customer: 'cus_123',
        amount_paid: 1980,
        amount_due: 1980,
        billing_reason: billingReason,
        parent: {
          type: 'subscription_details',
          subscription_details: {
            subscription: 'sub_123',
            metadata: {
              plan_code: 'standard',
            },
          },
        },
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'invoice.paid',
  } as unknown as Stripe.Event;
}

function buildInvoicePaymentFailedEvent(): Stripe.Event {
  return {
    id: 'evt_invoice_failed',
    object: 'event',
    api_version: '2025-03-31',
    created: 1,
    data: {
      object: {
        id: 'in_124',
        object: 'invoice',
        customer: 'cus_123',
        amount_paid: 0,
        amount_due: 1980,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'invoice.payment_failed',
  } as unknown as Stripe.Event;
}

function buildCustomerSubscriptionUpdatedEvent(priceId: 'price_standard' | 'price_premium'): Stripe.Event {
  return {
    id: 'evt_sub_updated',
    object: 'event',
    api_version: '2025-03-31',
    created: 1,
    data: {
      object: buildSubscription(priceId === 'price_standard' ? 'standard' : 'premium', priceId),
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'customer.subscription.updated',
  } as unknown as Stripe.Event;
}

function buildCustomerSubscriptionDeletedEvent(): Stripe.Event {
  return {
    id: 'evt_sub_deleted',
    object: 'event',
    api_version: '2025-03-31',
    created: 1,
    data: {
      object: buildSubscription(),
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'customer.subscription.deleted',
  } as unknown as Stripe.Event;
}

function buildSubscription(
  planCode: PaidPlanCode = 'standard',
  priceId: 'price_standard' | 'price_premium' = 'price_standard',
): Stripe.Subscription {
  return {
    id: 'sub_123',
    object: 'subscription',
    customer: 'cus_123',
    status: 'active',
    cancel_at_period_end: false,
    metadata: {
      plan_code: planCode,
    },
    items: {
      object: 'list',
      data: [
        {
          id: 'si_123',
          object: 'subscription_item',
          current_period_start: 1711929600,
          current_period_end: 1714521600,
          price: {
            id: priceId,
          },
        },
      ],
      has_more: false,
      url: '/v1/subscription_items',
    },
  } as unknown as Stripe.Subscription;
}
