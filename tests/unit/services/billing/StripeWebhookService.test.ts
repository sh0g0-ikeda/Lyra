import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import type {
  PaidPlanCode,
  SubscriptionPlanCode,
  SubscriptionStatus,
} from '../../../../src/domain/constants/billing.js';
import type {
  ActiveSubscriptionRecord,
  BillingUserProfile,
  PaymentRecord,
  PaymentRecordInput,
  SubscriptionRecord,
} from '../../../../src/domain/types/billing.js';
import type { Organization, OrganizationCreditBalance } from '../../../../src/domain/types/organization.js';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import { ValidationError } from '../../../../src/domain/errors/index.js';
import type { StripeBillingClientPort } from '../../../../src/infrastructure/stripe/StripeBillingClient.js';
import type { DatabaseClient } from '../../../../src/lib/db.js';
import type { BillingRepository } from '../../../../src/repositories/BillingRepository.js';
import type { OrganizationRepository } from '../../../../src/repositories/OrganizationRepository.js';
import type {
  BillingCreditGrantServicePort,
  GrantMonthlyCreditsParams,
  GrantPurchasedCreditsParams,
} from '../../../../src/services/credit/BillingCreditGrantService.js';
import { StripeWebhookService } from '../../../../src/services/billing/StripeWebhookService.js';
import type { OrganizationServicePort } from '../../../../src/services/organization/OrganizationService.js';

type SubscriptionPriceId =
  | 'price_standard'
  | 'price_premium'
  | 'price_enterprise_a'
  | 'price_enterprise_b'
  | 'price_enterprise_c';

class InMemoryBillingRepository implements BillingRepository {
  public processedEvents = new Set<string>();
  public userById = new Map<string, BillingUserProfile>();
  public userByCustomerId = new Map<string, BillingUserProfile>();
  public updatedPlans: Array<{ userId: string; planCode: string }> = [];
  public subscriptions: SubscriptionRecord[] = [];
  public deletedSubscriptions: string[] = [];
  public paymentRecords: PaymentRecordInput[] = [];
  public insertedCustomerIds: Array<{ userId: string; stripeCustomerId: string }> = [];
  public activeSubscriptionsByUser = new Map<string, Map<string, SubscriptionPlanCode>>();

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
      const next = { ...current, stripeCustomerId: current.stripeCustomerId ?? stripeCustomerId };
      this.userById.set(userId, next);
      if (next.stripeCustomerId !== null) {
        this.userByCustomerId.set(next.stripeCustomerId, next);
      }
      return next.stripeCustomerId;
    }

    return null;
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

  public setUserPlan(userId: string, planCode: SubscriptionPlanCode): void {
    const current = this.userById.get(userId);
    if (current === undefined) {
      return;
    }

    const next = { ...current, planCode };
    this.userById.set(userId, next);
    if (next.stripeCustomerId !== null) {
      this.userByCustomerId.set(next.stripeCustomerId, next);
    }
  }

  public async hasStripeEventProcessed(stripeEventId: string): Promise<boolean> {
    return this.processedEvents.has(stripeEventId);
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
    for (const subscriptions of this.activeSubscriptionsByUser.values()) {
      subscriptions.delete(stripeSubscriptionId);
    }
  }

  public addActiveSubscription(
    userId: string,
    stripeSubscriptionId: string,
    planCode: SubscriptionPlanCode = 'standard',
  ): void {
    const subscriptions = this.activeSubscriptionsByUser.get(userId) ?? new Map<string, SubscriptionPlanCode>();
    subscriptions.set(stripeSubscriptionId, planCode);
    this.activeSubscriptionsByUser.set(userId, subscriptions);
  }

  public async findLatestActiveSubscriptionForUser(userId: string): Promise<ActiveSubscriptionRecord | null> {
    const storedSubscription = this.subscriptions.find(
      (subscription) =>
        subscription.userId === userId && (subscription.status === 'active' || subscription.status === 'trialing'),
    );
    if (storedSubscription !== undefined) {
      return storedSubscription;
    }

    const activeSubscription = [...(this.activeSubscriptionsByUser.get(userId) ?? [])][0];
    if (activeSubscription === undefined) {
      return null;
    }

    const [stripeSubscriptionId, planCode] = activeSubscription;
    return {
      userId,
      organizationId: null,
      stripeSubscriptionId,
      planCode,
      status: 'active',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  public async findHighestActiveSubscriptionPlanForUserExcluding(
    userId: string,
    excludedStripeSubscriptionId: string,
  ): Promise<SubscriptionPlanCode | null> {
    const plans = this.subscriptions
      .filter(
        (subscription) =>
          subscription.userId === userId &&
          subscription.stripeSubscriptionId !== excludedStripeSubscriptionId &&
          (subscription.status === 'active' || subscription.status === 'trialing'),
      )
      .map((subscription) => subscription.planCode);

    for (const [subscriptionId, planCode] of this.activeSubscriptionsByUser.get(userId) ?? []) {
      if (subscriptionId !== excludedStripeSubscriptionId) {
        plans.push(planCode);
      }
    }

    return plans.sort(comparePlansDescending)[0] ?? null;
  }

  public async insertPaymentRecord(record: PaymentRecordInput): Promise<boolean> {
    const isDuplicate = this.paymentRecords.some((current) => {
      const sameCheckoutSession =
        record.stripeCheckoutSessionId !== null &&
        current.stripeCheckoutSessionId === record.stripeCheckoutSessionId;
      const sameInvoice =
        record.stripeInvoiceId !== null &&
        current.stripeInvoiceId === record.stripeInvoiceId;
      return (sameCheckoutSession || sameInvoice) && current.kind === record.kind && current.status === record.status;
    });
    if (isDuplicate) {
      return false;
    }

    this.paymentRecords.push(record);
    return true;
  }

  public async findLatestSubscriptionForOrganization(): Promise<null> {
    return null;
  }

  public async listPaymentRecordsByOrganizationId(): Promise<PaymentRecord[]> {
    return [];
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

function comparePlansDescending(left: SubscriptionPlanCode, right: SubscriptionPlanCode): number {
  return planRank(right) - planRank(left);
}

function planRank(planCode: SubscriptionPlanCode): number {
  if (planCode === 'enterprise_c') {
    return 5;
  }

  if (planCode === 'enterprise_b') {
    return 4;
  }

  if (planCode === 'enterprise_a') {
    return 3;
  }

  if (planCode === 'premium') {
    return 2;
  }

  if (planCode === 'standard') {
    return 1;
  }

  return 0;
}

class FakeStripeBillingClient implements StripeBillingClientPort {
  public event: Stripe.Event = buildCheckoutSubscriptionEvent();
  public subscription: Stripe.Subscription = buildSubscription();
  public constructError: Error | null = null;
  public retrieveSubscriptionCalls = 0;

  public async createCustomer(): Promise<never> {
    throw new Error('unused');
  }

  public async createCheckoutSession(): Promise<never> {
    throw new Error('unused');
  }

  public async createCustomerPortalSession(): Promise<never> {
    throw new Error('unused');
  }

  public async createSubscriptionUpdatePortalSession(): Promise<never> {
    throw new Error('unused');
  }

  public async constructWebhookEvent(): Promise<Stripe.Event> {
    if (this.constructError !== null) {
      throw this.constructError;
    }

    return this.event;
  }

  public async retrieveSubscription(): Promise<Stripe.Subscription> {
    this.retrieveSubscriptionCalls += 1;
    return this.subscription;
  }
}

describe('StripeWebhookService', () => {
  it('署名検証失敗はDB更新前にVALIDATION_ERRORで止める', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.constructError = new Error('No signatures found matching the expected signature for payload');
    const service = buildService(repository, creditGrantService, stripeClient);

    await expect(service.handleWebhook(Buffer.from('{}'), 'bad-signature')).rejects.toBeInstanceOf(ValidationError);

    expect(repository.processedEvents.size).toBe(0);
    expect(repository.paymentRecords).toHaveLength(0);
    expect(creditGrantService.monthlyGrants).toHaveLength(0);
    expect(creditGrantService.purchasedGrants).toHaveLength(0);
    expect(stripeClient.retrieveSubscriptionCalls).toBe(0);
  });

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
      amountJpy: 1000,
      status: 'paid',
    });
  });

  it('checkout.session.completed grants enterprise monthly credits to the organization workspace', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const organizationService = new FakeOrganizationService();
    const organizationRepository = new FakeOrganizationRepository();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutSubscriptionEvent({
      id: 'evt_checkout_enterprise_a',
      amountTotal: 10000,
      planCode: 'enterprise_a',
      organizationId: 'org-1',
    });
    stripeClient.subscription = buildSubscription('enterprise_a', 'price_enterprise_a', 'active', 'org-1');
    const service = buildService(
      repository,
      creditGrantService,
      stripeClient,
      organizationService as unknown as OrganizationServicePort,
      organizationRepository as unknown as OrganizationRepository,
    );

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.updatedPlans).toHaveLength(0);
    expect(organizationService.monthlyGrants[0]).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      amount: 600,
      stripeEventId: 'evt_checkout_enterprise_a',
    });
    expect(organizationRepository.organizations.get('org-1')).toMatchObject({
      planKey: 'enterprise_a',
      stripeSubscriptionId: 'sub_123',
    });
    expect(repository.paymentRecords[0]).toMatchObject({
      organizationId: 'org-1',
      kind: 'subscription',
      amountJpy: 10000,
      status: 'paid',
    });
  });

  it('checkout.session.completed accepts lyra_organization_id metadata for organization subscriptions', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const organizationService = new FakeOrganizationService();
    const organizationRepository = new FakeOrganizationRepository();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutSubscriptionEvent({
      id: 'evt_checkout_enterprise_a_lyra_metadata',
      amountTotal: 10000,
      planCode: 'enterprise_a',
      lyraOrganizationId: 'org-1',
    });
    stripeClient.subscription = buildSubscription('enterprise_a', 'price_enterprise_a', 'active', null, 'org-1');
    const service = buildService(
      repository,
      creditGrantService,
      stripeClient,
      organizationService as unknown as OrganizationServicePort,
      organizationRepository as unknown as OrganizationRepository,
    );

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(organizationService.monthlyGrants[0]).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      amount: 600,
      stripeEventId: 'evt_checkout_enterprise_a_lyra_metadata',
    });
    expect(repository.updatedPlans).toHaveLength(0);
  });

  it('invoice.paid subscription_cycle grants Enterprise C monthly credits to the organization workspace', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const organizationService = new FakeOrganizationService();
    const organizationRepository = new FakeOrganizationRepository();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildInvoicePaidEvent('subscription_cycle', 'evt_invoice_enterprise_c', 100000);
    stripeClient.subscription = buildSubscription('enterprise_c', 'price_enterprise_c', 'active', 'org-1');
    const service = buildService(
      repository,
      creditGrantService,
      stripeClient,
      organizationService as unknown as OrganizationServicePort,
      organizationRepository as unknown as OrganizationRepository,
    );

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.updatedPlans).toHaveLength(0);
    expect(organizationService.monthlyGrants[0]).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      amount: 7000,
      stripeEventId: 'evt_invoice_enterprise_c',
    });
    expect(organizationRepository.organizations.get('org-1')).toMatchObject({
      planKey: 'enterprise_c',
      stripeSubscriptionId: 'sub_123',
    });
    expect(repository.paymentRecords[0]).toMatchObject({
      organizationId: 'org-1',
      stripeInvoiceId: 'in_123',
      invoiceUrl: 'https://billing.stripe.test/invoice/in_123',
      amountJpy: 100000,
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
      amountJpy: 1100,
      status: 'paid',
    });
  });

  it('rejects paid checkout events whose customer differs from the billing user', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutCreditPurchaseEvent({
      id: 'evt_checkout_credit_customer_mismatch',
      customerId: 'cus_other',
    });
    const service = buildService(repository, creditGrantService, stripeClient);

    await expect(service.handleWebhook(Buffer.from('{}'), 'sig')).rejects.toBeInstanceOf(ValidationError);

    expect(creditGrantService.purchasedGrants).toHaveLength(0);
    expect(repository.paymentRecords).toHaveLength(0);
    expect(repository.updatedPlans).toHaveLength(0);
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
      amountJpy: 1100,
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
      amountJpy: 1100,
      status: 'failed',
    });
  });

  it('invoice.paid の subscription_cycle で月次 allowance を規定値へリセットする', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildInvoicePaidEvent('subscription_cycle');
    stripeClient.subscription = buildSubscription();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(creditGrantService.monthlyGrants).toHaveLength(1);
    expect(creditGrantService.monthlyGrants[0]).toMatchObject({
      userId: 'user-1',
      amount: 50,
      stripeEventId: 'evt_invoice_paid',
    });
    expect(creditGrantService.monthlyGrants[0]?.description).toContain('Monthly subscription renewal grant');
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
      amountJpy: 1000,
      status: 'failed',
    });
  });

  it('invoice.payment_failed は別の有効subscriptionがある場合にplanをfreeへ落とさない', async () => {
    const repository = seedRepository();
    repository.addActiveSubscription('user-1', 'sub_new');
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildInvoicePaymentFailedEvent();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'standard' });
    expect(repository.paymentRecords[0]).toMatchObject({
      stripeInvoiceId: 'in_124',
      amountJpy: 1000,
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

  it('customer.subscription.updated uses price id before stale metadata plan code', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCustomerSubscriptionUpdatedEvent('price_premium');
    stripeClient.subscription = buildSubscription('standard', 'price_premium');
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.subscriptions[0]).toMatchObject({
      stripeSubscriptionId: 'sub_123',
      planCode: 'premium',
    });
    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'premium' });
  });

  it('customer.subscription.updated が非active状態なら plan を free に戻す', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCustomerSubscriptionUpdatedEvent('price_premium', 'paused');
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.subscriptions[0]).toMatchObject({
      stripeSubscriptionId: 'sub_123',
      planCode: 'premium',
      status: 'paused',
    });
    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'free' });
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

  it('customer.subscription.deleted は別の有効subscriptionがある場合にplanをfreeへ落とさない', async () => {
    const repository = seedRepository();
    repository.addActiveSubscription('user-1', 'sub_new');
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCustomerSubscriptionDeletedEvent();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.deletedSubscriptions).toEqual(['sub_123']);
    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'standard' });
  });

  it('customer.subscription.deleted はpremium解約後に残るstandard subscriptionへplanを同期する', async () => {
    const repository = seedRepository();
    repository.setUserPlan('user-1', 'premium');
    repository.addActiveSubscription('user-1', 'sub_standard', 'standard');
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCustomerSubscriptionDeletedEvent('premium', 'price_premium');
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.deletedSubscriptions).toEqual(['sub_123']);
    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'standard' });
  });

  it('customer.subscription.updated は別の有効subscriptionがある場合に非activeイベントでplanをfreeへ落とさない', async () => {
    const repository = seedRepository();
    repository.addActiveSubscription('user-1', 'sub_new');
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCustomerSubscriptionUpdatedEvent('price_standard', 'paused');
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.subscriptions[0]).toMatchObject({
      stripeSubscriptionId: 'sub_123',
      status: 'paused',
    });
    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'standard' });
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

  it('同じ checkout session の paid event が別event idで来ても購入クレジットを二重付与しない', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, creditGrantService, stripeClient);

    stripeClient.event = buildCheckoutCreditPurchaseEvent({ id: 'evt_checkout_credit_completed' });
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    stripeClient.event = buildCheckoutCreditPurchaseEvent({
      id: 'evt_checkout_credit_async_success',
      type: 'checkout.session.async_payment_succeeded',
      paymentStatus: 'paid',
    });
    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.processedEvents.has('evt_checkout_credit_completed')).toBe(true);
    expect(repository.processedEvents.has('evt_checkout_credit_async_success')).toBe(true);
    expect(repository.paymentRecords).toHaveLength(1);
    expect(creditGrantService.purchasedGrants).toHaveLength(1);
  });

  it('同じ invoice の paid event が別event idで来ても月次クレジットを二重付与しない', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, creditGrantService, stripeClient);

    stripeClient.event = buildInvoicePaidEvent('subscription_cycle', 'evt_invoice_paid_first');
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    stripeClient.event = buildInvoicePaidEvent('subscription_cycle', 'evt_invoice_paid_second');
    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.processedEvents.has('evt_invoice_paid_first')).toBe(true);
    expect(repository.processedEvents.has('evt_invoice_paid_second')).toBe(true);
    expect(repository.paymentRecords).toHaveLength(1);
    expect(creditGrantService.monthlyGrants).toHaveLength(1);
  });
  it('processed subscription checkout event returns before retrieving Stripe subscription', async () => {
    const repository = seedRepository();
    repository.processedEvents.add('evt_checkout_sub');
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutSubscriptionEvent();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(stripeClient.retrieveSubscriptionCalls).toBe(0);
    expect(creditGrantService.monthlyGrants).toHaveLength(0);
    expect(repository.subscriptions).toHaveLength(0);
  });

  it('does not grant monthly credits when subscription checkout is below the minimum price', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutSubscriptionEvent({
      id: 'evt_checkout_sub_underpaid',
      amountTotal: 999,
    });
    stripeClient.subscription = buildSubscription();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.processedEvents.has('evt_checkout_sub_underpaid')).toBe(true);
    expect(repository.subscriptions).toHaveLength(0);
    expect(repository.updatedPlans).toHaveLength(0);
    expect(creditGrantService.monthlyGrants).toHaveLength(0);
    expect(repository.paymentRecords[0]).toMatchObject({
      kind: 'subscription',
      amountJpy: 999,
      status: 'failed',
    });
  });

  it('does not grant purchased credits when credit checkout is below the minimum price', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildCheckoutCreditPurchaseEvent({
      id: 'evt_checkout_credit_underpaid',
      amountTotal: 1099,
    });
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.processedEvents.has('evt_checkout_credit_underpaid')).toBe(true);
    expect(creditGrantService.purchasedGrants).toHaveLength(0);
    expect(repository.paymentRecords[0]).toMatchObject({
      kind: 'credit_purchase',
      amountJpy: 1099,
      status: 'failed',
    });
  });

  it('does not grant monthly credits when subscription invoice is below the minimum price', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildInvoicePaidEvent('subscription_cycle', 'evt_invoice_underpaid', 999);
    stripeClient.subscription = buildSubscription();
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.processedEvents.has('evt_invoice_underpaid')).toBe(true);
    expect(creditGrantService.monthlyGrants).toHaveLength(0);
    expect(repository.paymentRecords[0]).toMatchObject({
      stripeInvoiceId: 'in_123',
      amountJpy: 999,
      status: 'failed',
    });
  });

  it('subscription_update の日割り請求でも premium plan と月次枠を反映する', async () => {
    const repository = seedRepository();
    repository.setUserPlan('user-1', 'standard');
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildInvoicePaidEvent('subscription_update', 'evt_invoice_upgrade', 1500);
    stripeClient.subscription = buildSubscription('premium', 'price_premium');
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'premium' });
    expect(creditGrantService.monthlyGrants).toHaveLength(1);
    expect(creditGrantService.monthlyGrants[0]).toMatchObject({
      userId: 'user-1',
      amount: 175,
      stripeEventId: 'evt_invoice_upgrade',
    });
    expect(creditGrantService.monthlyGrants[0]?.description).toContain('Subscription plan change grant');
    expect(repository.paymentRecords[0]).toMatchObject({
      stripeInvoiceId: 'in_123',
      amountJpy: 1500,
      status: 'paid',
    });
  });

  it('subscription_update の0円請求は plan だけ反映し月次枠は付与しない', async () => {
    const repository = seedRepository();
    repository.setUserPlan('user-1', 'standard');
    const creditGrantService = new FakeBillingCreditGrantService();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildInvoicePaidEvent('subscription_update', 'evt_invoice_upgrade_free', 0);
    stripeClient.subscription = buildSubscription('premium', 'price_premium');
    const service = buildService(repository, creditGrantService, stripeClient);

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.updatedPlans[0]).toEqual({ userId: 'user-1', planCode: 'premium' });
    expect(creditGrantService.monthlyGrants).toHaveLength(0);
    expect(repository.paymentRecords[0]).toMatchObject({
      stripeInvoiceId: 'in_123',
      amountJpy: 0,
      status: 'paid',
    });
  });

  it('subscription_update reflects Enterprise B and grants its monthly credit bucket to the organization', async () => {
    const repository = seedRepository();
    const creditGrantService = new FakeBillingCreditGrantService();
    const organizationService = new FakeOrganizationService();
    const organizationRepository = new FakeOrganizationRepository();
    const stripeClient = new FakeStripeBillingClient();
    stripeClient.event = buildInvoicePaidEvent('subscription_update', 'evt_invoice_enterprise_b_upgrade', 20000);
    stripeClient.subscription = buildSubscription('enterprise_b', 'price_enterprise_b', 'active', 'org-1');
    const service = buildService(
      repository,
      creditGrantService,
      stripeClient,
      organizationService as unknown as OrganizationServicePort,
      organizationRepository as unknown as OrganizationRepository,
    );

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(repository.updatedPlans).toHaveLength(0);
    expect(organizationService.monthlyGrants[0]).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      amount: 2000,
      stripeEventId: 'evt_invoice_enterprise_b_upgrade',
    });
    expect(organizationRepository.organizations.get('org-1')).toMatchObject({
      planKey: 'enterprise_b',
    });
    expect(repository.paymentRecords[0]).toMatchObject({
      organizationId: 'org-1',
      stripeInvoiceId: 'in_123',
      amountJpy: 20000,
      status: 'paid',
    });
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

function buildOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    type: 'business',
    name: 'Lyra Enterprise',
    legalName: 'Lyra Enterprise Inc.',
    status: 'active',
    planKey: 'enterprise_a',
    billingEmail: 'billing@example.com',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: null,
    createdByUserId: 'user-1',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildService(
  repository: BillingRepository,
  creditGrantService: BillingCreditGrantServicePort,
  stripeClient: StripeBillingClientPort,
  organizationService: OrganizationServicePort = buildUnusedOrganizationService(),
  organizationRepository: OrganizationRepository = buildUnusedOrganizationRepository(),
): StripeWebhookService {
  return new StripeWebhookService(
    repository,
    creditGrantService,
    organizationService,
    organizationRepository,
    stripeClient,
    {
      subscriptionPlanByPriceId: {
        price_standard: 'standard',
        price_premium: 'premium',
        price_enterprise_a: 'enterprise_a',
        price_enterprise_b: 'enterprise_b',
        price_enterprise_c: 'enterprise_c',
      },
    },
  );
}

class FakeOrganizationService {
  public monthlyGrants: Array<{
    organizationId: string;
    actorUserId: string | null;
    amount: number;
    description: string;
    stripeEventId?: string | null;
  }> = [];
  public purchasedGrants: Array<{
    organizationId: string;
    actorUserId: string | null;
    amount: number;
    description: string;
    stripeEventId?: string | null;
    packageCode?: string | null;
  }> = [];

  public async grantMonthlyCredits(input: {
    organizationId: string;
    actorUserId: string | null;
    amount: number;
    description: string;
    stripeEventId?: string | null;
  }): Promise<OrganizationCreditBalance> {
    this.monthlyGrants.push(input);
    return {
      organizationId: input.organizationId,
      monthlyCredits: input.amount,
      purchasedCredits: 0,
      monthlyExpiresAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };
  }

  public async grantPurchasedCredits(input: {
    organizationId: string;
    actorUserId: string | null;
    amount: number;
    description: string;
    stripeEventId?: string | null;
    packageCode?: string | null;
  }): Promise<OrganizationCreditBalance> {
    this.purchasedGrants.push(input);
    return {
      organizationId: input.organizationId,
      monthlyCredits: 0,
      purchasedCredits: input.amount,
      monthlyExpiresAt: null,
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };
  }
}

class FakeOrganizationRepository {
  public organizations = new Map<string, Organization>();
  public updates: Array<{ organizationId: string; input: Record<string, unknown> }> = [];
  public auditLogs: Array<{
    organizationId: string;
    actorUserId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    metadata?: Record<string, unknown>;
  }> = [];

  public constructor() {
    this.organizations.set('org-1', buildOrganization());
  }

  public async findOrganizationById(organizationId: string): Promise<Organization | null> {
    return this.organizations.get(organizationId) ?? null;
  }

  public async updateOrganization(
    organizationId: string,
    input: Partial<Organization> & {
      planKey?: Organization['planKey'];
      stripeCustomerId?: string | null;
      stripeSubscriptionId?: string | null;
    },
  ): Promise<Organization | null> {
    const current = this.organizations.get(organizationId);
    if (current === undefined) {
      return null;
    }
    const next: Organization = {
      ...current,
      ...input,
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };
    this.organizations.set(organizationId, next);
    this.updates.push({ organizationId, input });
    return next;
  }

  public async insertAuditLog(input: {
    organizationId: string;
    actorUserId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.auditLogs.push(input);
  }
}

function buildUnusedOrganizationService(): OrganizationServicePort {
  return new Proxy(
    {},
    {
      get() {
        return async (): Promise<never> => {
          throw new Error('unexpected organization service call in personal webhook test');
        };
      },
    },
  ) as unknown as OrganizationServicePort;
}

function buildUnusedOrganizationRepository(): OrganizationRepository {
  return new Proxy(
    {},
    {
      get() {
        return async (): Promise<never> => {
          throw new Error('unexpected organization repository call in personal webhook test');
        };
      },
    },
  ) as unknown as OrganizationRepository;
}

function buildCheckoutSubscriptionEvent(options: {
  id?: string;
  paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required';
  type?: string;
  customerId?: string;
  amountTotal?: number;
  planCode?: PaidPlanCode;
  organizationId?: string;
  lyraOrganizationId?: string;
} = {}): Stripe.Event {
  const planCode = options.planCode ?? 'standard';
  return {
    id: options.id ?? 'evt_checkout_sub',
    object: 'event',
    api_version: '2025-03-31',
    created: 1,
    data: {
      object: {
        id: 'cs_sub_123',
        object: 'checkout.session',
        customer: options.customerId ?? 'cus_123',
        subscription: 'sub_123',
        client_reference_id: 'user-1',
        metadata: {
          kind: 'subscription',
          user_id: 'user-1',
          lyra_organization_id: options.lyraOrganizationId ?? '',
          organization_id: options.organizationId ?? '',
          plan_code: planCode,
        },
        payment_status: options.paymentStatus ?? 'paid',
        amount_total: options.amountTotal ?? 1000,
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
  customerId?: string;
  amountTotal?: number;
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
        customer: options.customerId ?? 'cus_123',
        subscription: null,
        client_reference_id: 'user-1',
        metadata: {
          kind: 'credit_purchase',
          user_id: 'user-1',
          package_code: 'credits_1000',
        },
        payment_status: options.paymentStatus ?? 'paid',
        amount_total: options.amountTotal ?? 1100,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: options.type ?? 'checkout.session.completed',
  } as unknown as Stripe.Event;
}

function buildInvoicePaidEvent(
  billingReason: Stripe.Invoice.BillingReason,
  id = 'evt_invoice_paid',
  amountPaid = 1000,
): Stripe.Event {
  return {
    id,
    object: 'event',
    api_version: '2025-03-31',
    created: 1,
    data: {
      object: {
        id: 'in_123',
        object: 'invoice',
        customer: 'cus_123',
        hosted_invoice_url: 'https://billing.stripe.test/invoice/in_123',
        amount_paid: amountPaid,
        amount_due: amountPaid,
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

function buildInvoicePaymentFailedEvent(stripeSubscriptionId: string | null = 'sub_123'): Stripe.Event {
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
        amount_due: 1000,
        parent:
          stripeSubscriptionId === null
            ? null
            : {
                type: 'subscription_details',
                subscription_details: {
                  subscription: stripeSubscriptionId,
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
    type: 'invoice.payment_failed',
  } as unknown as Stripe.Event;
}

function buildCustomerSubscriptionUpdatedEvent(
  priceId: SubscriptionPriceId,
  status: SubscriptionStatus = 'active',
): Stripe.Event {
  const planCodeByPriceId: Record<SubscriptionPriceId, PaidPlanCode> = {
    price_standard: 'standard',
    price_premium: 'premium',
    price_enterprise_a: 'enterprise_a',
    price_enterprise_b: 'enterprise_b',
    price_enterprise_c: 'enterprise_c',
  };
  return {
    id: 'evt_sub_updated',
    object: 'event',
    api_version: '2025-03-31',
    created: 1,
    data: {
      object: buildSubscription(planCodeByPriceId[priceId], priceId, status),
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'customer.subscription.updated',
  } as unknown as Stripe.Event;
}

function buildCustomerSubscriptionDeletedEvent(
  planCode: PaidPlanCode = 'standard',
  priceId: SubscriptionPriceId = 'price_standard',
): Stripe.Event {
  return {
    id: 'evt_sub_deleted',
    object: 'event',
    api_version: '2025-03-31',
    created: 1,
    data: {
      object: buildSubscription(planCode, priceId),
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'customer.subscription.deleted',
  } as unknown as Stripe.Event;
}

function buildSubscription(
  planCode: PaidPlanCode = 'standard',
  priceId: SubscriptionPriceId = 'price_standard',
  status: SubscriptionStatus = 'active',
  organizationId?: string | null,
  lyraOrganizationId?: string,
): Stripe.Subscription {
  return {
    id: 'sub_123',
    object: 'subscription',
    customer: 'cus_123',
    status,
    cancel_at_period_end: false,
    metadata: {
      plan_code: planCode,
      user_id: 'user-1',
      lyra_organization_id: lyraOrganizationId ?? '',
      organization_id: organizationId ?? '',
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
