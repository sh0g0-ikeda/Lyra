import { describe, expect, it } from 'vitest';
import { ConfigurationError, ConflictError, NotFoundError } from '../../../../src/domain/errors/index.js';
import type { BillingUserProfile } from '../../../../src/domain/types/billing.js';
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

  public async markStripeEventProcessed(): Promise<boolean> {
    return true;
  }

  public async upsertSubscription(): Promise<void> {}

  public async markSubscriptionDeleted(): Promise<void> {}

  public async insertPaymentRecord(): Promise<boolean> {
    return true;
  }
}

class FakeStripeBillingClient implements StripeBillingClientPort {
  public createdCustomerUserId: string | null = null;
  public checkoutMode: 'payment' | 'subscription' | null = null;
  public checkoutPriceId: string | null = null;
  public checkoutCustomerId: string | null = null;
  public portalCustomerId: string | null = null;

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

  public constructWebhookEvent(): never {
    throw new Error('unused');
  }

  public async retrieveSubscription(): Promise<never> {
    throw new Error('unused');
  }
}

describe('BillingService', () => {
  it('free ユーザーのサブスク Checkout で Stripe customer を作成して session を返す', async () => {
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

  it('有料プラン中のユーザーは subscription checkout を作れず portal へ誘導する', async () => {
    const repository = new InMemoryBillingRepository();
    repository.billingUser = {
      ...repository.billingUser!,
      planCode: 'standard',
    };
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    await expect(
      service.createSubscriptionCheckoutSession(
        {
          ...freeUser,
          planCode: 'standard',
        },
        'premium',
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('subscription checkout uses the database plan as the source of truth', async () => {
    const repository = new InMemoryBillingRepository();
    repository.billingUser = {
      ...repository.billingUser!,
      stripeCustomerId: 'cus_existing',
      planCode: 'standard',
    };
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    await expect(service.createSubscriptionCheckoutSession(freeUser, 'premium')).rejects.toBeInstanceOf(ConflictError);

    expect(stripeClient.createdCustomerUserId).toBeNull();
    expect(stripeClient.checkoutMode).toBeNull();
  });

  it('credit checkout は既存 customer を再利用する', async () => {
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

  it('portal は customer がないと conflict になる', async () => {
    const repository = new InMemoryBillingRepository();
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    await expect(service.createCustomerPortalSession(freeUser.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('billing user が存在しない場合は not found になる', async () => {
    const repository = new InMemoryBillingRepository();
    repository.billingUser = null;
    const stripeClient = new FakeStripeBillingClient();
    const service = buildService(repository, stripeClient);

    await expect(service.createCreditCheckoutSession(freeUser, 'credits_200')).rejects.toBeInstanceOf(NotFoundError);
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
): BillingService {
  return new BillingService(repository, stripeClient, {
    successUrl: 'https://app.lyra.test/billing/success',
    cancelUrl: 'https://app.lyra.test/billing/cancel',
    portalReturnUrl: 'https://app.lyra.test/settings/billing',
    subscriptionPriceIds: {
      standard: 'price_standard',
      premium: 'price_premium',
    },
    creditPackagePriceIds: {
      credits_200: 'price_credits_200',
      credits_1000: 'price_credits_1000',
      credits_3000: 'price_credits_3000',
    },
  });
}
