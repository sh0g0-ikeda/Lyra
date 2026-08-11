import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { ConfigurationError, ConflictError, NotFoundError } from '../../../../src/domain/errors/index.js';
import type {
  ActiveSubscriptionRecord,
  BillingUserProfile,
  PaymentRecord,
  PersonalSubscriptionSummary,
} from '../../../../src/domain/types/billing.js';
import type { AuthenticatedUser } from '../../../../src/domain/types/user.js';
import type { StripeBillingClientPort } from '../../../../src/infrastructure/stripe/StripeBillingClient.js';
import type { DatabaseClient } from '../../../../src/lib/db.js';
import type { BillingRepository } from '../../../../src/repositories/BillingRepository.js';
import { BillingService, assertBillingConfig } from '../../../../src/services/billing/BillingService.js';
import type { QueryResult, QueryResultRow } from 'pg';

const freeUser: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

class InMemoryBillingRepository implements BillingRepository {
  public billingUser: BillingUserProfile | null = {
    userId: freeUser.id,
    email: freeUser.email,
    stripeCustomerId: null,
    planCode: 'free',
  };
  public activeSubscription: ActiveSubscriptionRecord | null = null;
  public personalSubscription: PersonalSubscriptionSummary | null = null;
  public persistedCustomerId: string | null = null;

  private readonly fakeClient: DatabaseClient = {
    query: async <T extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<T>> => ({
      command: '',
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: [] as T[],
    }),
  };

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this.fakeClient);
  }

  public async findBillingUserProfile(): Promise<BillingUserProfile | null> {
    return this.billingUser;
  }

  public async findBillingUserProfileByStripeCustomerId(): Promise<BillingUserProfile | null> {
    return this.billingUser;
  }

  public async setStripeCustomerId(_userId: string, stripeCustomerId: string): Promise<string | null> {
    this.persistedCustomerId = this.billingUser?.stripeCustomerId ?? stripeCustomerId;
    if (this.billingUser !== null && this.billingUser.stripeCustomerId === null) {
      this.billingUser = {
        ...this.billingUser,
        stripeCustomerId,
      };
    }

    return this.persistedCustomerId;
  }

  public async updateUserPlanCode(): Promise<boolean> {
    return true;
  }

  public async findLatestActiveSubscriptionForUser(): Promise<ActiveSubscriptionRecord | null> {
    return this.activeSubscription;
  }

  public async findLatestSubscriptionSummaryForUser(): Promise<PersonalSubscriptionSummary | null> {
    return this.personalSubscription;
  }

  public async findLatestSubscriptionForOrganization(): Promise<null> {
    return null;
  }

  public async findHighestActiveSubscriptionPlanForUserExcluding(): Promise<BillingUserProfile['planCode'] | null> {
    throw new Error('unused');
  }

  public async hasStripeEventProcessed(): Promise<boolean> {
    return false;
  }

  public async markStripeEventProcessed(): Promise<boolean> {
    return true;
  }

  public async upsertSubscription(): Promise<void> {}

  public async markSubscriptionDeleted(): Promise<void> {}

  public async insertPaymentRecord(): Promise<boolean> {
    return true;
  }

  public async listPaymentRecordsByOrganizationId(): Promise<PaymentRecord[]> {
    return [];
  }
}

class FakeStripeBillingClient implements StripeBillingClientPort {
  public createdCustomerUserId: string | null = null;
  public checkoutMode: 'payment' | 'subscription' | null = null;
  public checkoutPriceId: string | null = null;
  public checkoutCustomerId: string | null = null;
  public portalCustomerId: string | null = null;
  public portalUpdateCustomerId: string | null = null;
  public portalUpdateSubscriptionId: string | null = null;
  public portalUpdateSubscriptionItemId: string | null = null;
  public portalUpdatePriceId: string | null = null;
  public retrieveSubscriptionCalls = 0;
  public subscription: Stripe.Subscription = buildStripeSubscription();

  public async createCustomer(input: { userId: string }): Promise<{ id: string }> {
    this.createdCustomerUserId = input.userId;
    return { id: 'cus_123' };
  }

  public async createCheckoutSession(input: {
    customerId: string;
    mode: 'payment' | 'subscription';
    priceId: string;
  }): Promise<{ id: string; url: string }> {
    this.checkoutCustomerId = input.customerId;
    this.checkoutMode = input.mode;
    this.checkoutPriceId = input.priceId;
    return {
      id: 'cs_test_123',
      url: 'https://checkout.stripe.test/session',
    };
  }

  public async createCustomerPortalSession(input: { customerId: string }): Promise<{ url: string }> {
    this.portalCustomerId = input.customerId;
    return {
      url: 'https://billing.stripe.test/session',
    };
  }

  public async createSubscriptionUpdatePortalSession(input: {
    customerId: string;
    subscriptionId: string;
    subscriptionItemId: string;
    priceId: string;
  }): Promise<{ id: string; url: string }> {
    this.portalUpdateCustomerId = input.customerId;
    this.portalUpdateSubscriptionId = input.subscriptionId;
    this.portalUpdateSubscriptionItemId = input.subscriptionItemId;
    this.portalUpdatePriceId = input.priceId;
    return {
      id: 'bps_update_123',
      url: 'https://billing.stripe.test/update-plan',
    };
  }

  public async constructWebhookEvent(): Promise<never> {
    throw new Error('unused');
  }

  public async retrieveSubscription(): Promise<Stripe.Subscription> {
    this.retrieveSubscriptionCalls += 1;
    return this.subscription;
  }
}

describe('BillingService', () => {
  it('reads the persisted personal subscription summary without a Stripe API request', async () => {
    const repository = new InMemoryBillingRepository();
    repository.personalSubscription = {
      planCode: 'premium',
      status: 'trialing',
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      store: null,
      scheduledPlanCode: null,
      scheduledPlanEffectiveAt: null,
    };
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    await expect(service.getPersonalSubscriptionSummary(freeUser.id)).resolves.toEqual(repository.personalSubscription);
    expect(stripeClient.checkoutMode).toBeNull();
    expect(stripeClient.retrieveSubscriptionCalls).toBe(0);
  });

  it('free user subscription checkout creates Stripe customer and session', async () => {
    const repository = new InMemoryBillingRepository();
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    const result = await service.createSubscriptionCheckoutSession(freeUser, 'standard');

    expect(result).toEqual({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.test/session',
    });
    expect(stripeClient.createdCustomerUserId).toBe(freeUser.id);
    expect(stripeClient.checkoutMode).toBe('subscription');
    expect(stripeClient.checkoutPriceId).toBe('price_standard');
    expect(repository.persistedCustomerId).toBe('cus_123');
  });

  it('standard to premium returns a Stripe portal subscription update confirmation flow', async () => {
    const repository = new InMemoryBillingRepository();
    repository.billingUser = {
      ...repository.billingUser!,
      stripeCustomerId: 'cus_existing',
      planCode: 'standard',
    };
    repository.activeSubscription = buildActiveSubscription();
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    const result = await service.createSubscriptionCheckoutSession(
      {
        ...freeUser,
        planCode: 'standard',
      },
      'premium',
    );

    expect(result).toEqual({
      sessionId: 'bps_update_123',
      url: 'https://billing.stripe.test/update-plan',
    });
    expect(stripeClient.checkoutMode).toBeNull();
    expect(stripeClient.portalUpdateCustomerId).toBe('cus_existing');
    expect(stripeClient.portalUpdateSubscriptionId).toBe('sub_standard');
    expect(stripeClient.portalUpdateSubscriptionItemId).toBe('si_standard');
    expect(stripeClient.portalUpdatePriceId).toBe('price_premium');
  });

  it('rejects enterprise checkout from personal billing', async () => {
    const repository = new InMemoryBillingRepository();
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    await expect(service.createSubscriptionCheckoutSession(freeUser, 'enterprise_a')).rejects.toThrow(
      new ConflictError('Enterprise subscriptions must be managed from an organization workspace'),
    );
    expect(stripeClient.checkoutMode).toBeNull();
  });

  it('reports only consumer subscription plans in the personal catalog', () => {
    const repository = new InMemoryBillingRepository();
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient, {
      enterprise_a: undefined,
      enterprise_b: undefined,
      enterprise_c: undefined,
    });

    expect(service.getSubscriptionPlanCatalog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planCode: 'standard', configured: true, isEnterprise: false }),
        expect.objectContaining({ planCode: 'premium', configured: true, isEnterprise: false }),
      ]),
    );
    expect(service.getSubscriptionPlanCatalog()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ planCode: 'enterprise_a' })]),
    );
  });

  it('same paid plan change is rejected', async () => {
    const repository = new InMemoryBillingRepository();
    repository.billingUser = {
      ...repository.billingUser!,
      stripeCustomerId: 'cus_existing',
      planCode: 'standard',
    };
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    await expect(service.createSubscriptionCheckoutSession(freeUser, 'standard')).rejects.toBeInstanceOf(
      ConflictError,
    );

    expect(stripeClient.createdCustomerUserId).toBeNull();
    expect(stripeClient.checkoutMode).toBeNull();
  });

  it('premium to standard downgrade is rejected and left to customer portal management', async () => {
    const repository = new InMemoryBillingRepository();
    repository.billingUser = {
      ...repository.billingUser!,
      stripeCustomerId: 'cus_existing',
      planCode: 'premium',
    };
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    await expect(service.createSubscriptionCheckoutSession(freeUser, 'standard')).rejects.toBeInstanceOf(
      ConflictError,
    );

    expect(stripeClient.checkoutMode).toBeNull();
    expect(stripeClient.portalUpdatePriceId).toBeNull();
  });

  it('credit checkout reuses existing customer', async () => {
    const repository = new InMemoryBillingRepository();
    repository.billingUser = {
      ...repository.billingUser!,
      stripeCustomerId: 'cus_existing',
    };
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    const result = await service.createCreditCheckoutSession(freeUser, 'credits_3000');

    expect(result.packageCode).toBe('credits_3000');
    expect(stripeClient.createdCustomerUserId).toBeNull();
    expect(stripeClient.checkoutCustomerId).toBe('cus_existing');
    expect(stripeClient.checkoutMode).toBe('payment');
    expect(stripeClient.checkoutPriceId).toBe('price_credits_3000');
  });

  it('portal requires an existing Stripe customer', async () => {
    const repository = new InMemoryBillingRepository();
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    await expect(service.createCustomerPortalSession(freeUser.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('missing billing user returns not found', async () => {
    const repository = new InMemoryBillingRepository();
    repository.billingUser = null;
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    await expect(service.createCreditCheckoutSession(freeUser, 'credits_200')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('assertBillingConfig', () => {
  it('rejects blank billing config values', () => {
    expect(() => {
      assertBillingConfig({
        successUrl: 'https://app.lyra.test/billing/success',
        cancelUrl: ' ',
        portalReturnUrl: 'https://app.lyra.test/settings/billing',
        subscriptionPriceIds: {
          standard: 'price_standard',
          premium: 'price_premium',
          enterprise_a: undefined,
          enterprise_b: undefined,
          enterprise_c: undefined,
        },
        creditPackagePriceIds: {
          credits_200: 'price_credits_200',
          credits_1000: '',
          credits_3000: 'price_credits_3000',
        },
      });
    }).toThrow(ConfigurationError);
  });
});

function buildService(
  repository: BillingRepository,
  stripeClient: StripeBillingClientPort,
  enterprisePriceIds: {
    enterprise_a?: string;
    enterprise_b?: string;
    enterprise_c?: string;
  } = {
    enterprise_a: 'price_enterprise_a',
    enterprise_b: 'price_enterprise_b',
    enterprise_c: 'price_enterprise_c',
  },
): BillingService {
  return new BillingService(repository, stripeClient, {
    successUrl: 'https://app.lyra.test/billing/success',
    cancelUrl: 'https://app.lyra.test/billing/cancel',
    portalReturnUrl: 'https://app.lyra.test/settings/billing',
    subscriptionPriceIds: {
      standard: 'price_standard',
      premium: 'price_premium',
      enterprise_a: enterprisePriceIds.enterprise_a,
      enterprise_b: enterprisePriceIds.enterprise_b,
      enterprise_c: enterprisePriceIds.enterprise_c,
    },
    creditPackagePriceIds: {
      credits_200: 'price_credits_200',
      credits_1000: 'price_credits_1000',
      credits_3000: 'price_credits_3000',
    },
  });
}

function buildActiveSubscription(): ActiveSubscriptionRecord {
  return {
    userId: freeUser.id,
    organizationId: null,
    stripeSubscriptionId: 'sub_standard',
    planCode: 'standard',
    status: 'active',
    currentPeriodStart: new Date('2026-06-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
    cancelAtPeriodEnd: true,
  };
}

function buildStripeSubscription(): Stripe.Subscription {
  return {
    id: 'sub_standard',
    object: 'subscription',
    customer: 'cus_existing',
    status: 'active',
    items: {
      object: 'list',
      data: [
        {
          id: 'si_standard',
          object: 'subscription_item',
          quantity: 1,
        },
      ],
      has_more: false,
      url: '/v1/subscription_items?subscription=sub_standard',
    },
  } as Stripe.Subscription;
}
