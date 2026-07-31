import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createGooglePlayObfuscatedAccountId,
  createStoreProductCatalog,
  type VerifiedStorePurchase,
} from '../../../../src/domain/storePurchase.js';
import type { CreditBalance, CreditLedgerEntry } from '../../../../src/domain/types/credit.js';
import type { DatabaseClient } from '../../../../src/lib/db.js';
import type {
  CreditLedgerBucketDeltaSummary,
  CreditRepository,
} from '../../../../src/repositories/CreditRepository.js';
import type {
  CreateStorePurchaseInput,
  StorePurchaseEventInput,
  StorePurchaseRecord,
  StorePurchaseRepository,
  StorePurchaseUserRecord,
  StoreSubscriptionSummaryRecord,
  UpdateStorePurchaseInput,
} from '../../../../src/repositories/StorePurchaseRepository.js';
import {
  MobileStorePurchaseService,
  type AppleStorePurchaseVerifierPort,
  type GooglePlayPurchaseVerifierPort,
  type GoogleProviderCompletionInput,
} from '../../../../src/services/billing/MobileStorePurchaseService.js';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const identifierSecret = '01234567890123456789012345678901';
const observedAt = new Date('2026-07-31T00:00:00.000Z');

describe('MobileStorePurchaseService', () => {
  it('Apple credit packを個人残高へ一度だけ付与しraw IDを保存しない', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const apple = new FakeAppleVerifier(applePurchase());
    const service = createService(repository, credits, apple, new FakeGoogleVerifier());

    const first = await service.verifyApplePurchase({
      userId,
      signedTransaction: 'signed.transaction.not.persisted',
      environment: 'sandbox',
    });
    const duplicate = await service.verifyApplePurchase({
      userId,
      signedTransaction: 'signed.transaction.not.persisted',
      environment: 'sandbox',
    });

    expect(first).toMatchObject({ creditsChanged: 10, isDuplicate: false });
    expect(duplicate).toMatchObject({ creditsChanged: 0, isDuplicate: true });
    expect(credits.balance.purchasedCredits).toBe(10);
    expect(credits.ledger).toHaveLength(1);
    expect(repository.purchases[0]?.externalPurchaseKey).toHaveLength(43);
    expect(repository.purchases[0]?.externalPurchaseKey).not.toContain('raw-original-id');
  });

  it('削除済みaccountのprovider eventは台帳化してもcreditとplanを復活させない', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    repository.deletedUsers.add(userId);
    const credits = new FakeCreditRepository();
    const service = createService(
      repository,
      credits,
      new FakeAppleVerifier(applePurchase()),
      new FakeGoogleVerifier(),
    );

    const result = await service.verifyApplePurchase({
      userId,
      signedTransaction: 'post-deletion-event',
      environment: 'sandbox',
    });

    expect(result.creditsChanged).toBe(0);
    expect(repository.purchases).toHaveLength(1);
    expect(repository.events).toHaveLength(1);
    expect(repository.users.get(userId)?.planCode).toBe('free');
    expect(credits.ledger).toHaveLength(0);
  });

  it('pendingとcancelledでは新しいcreditを付与しない', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const apple = new FakeAppleVerifier(
      applePurchase({ state: 'pending', eventId: 'pending' }),
      applePurchase({
        state: 'cancelled',
        eventId: 'cancelled',
        observedAt: new Date('2026-07-31T01:00:00.000Z'),
      }),
    );
    const service = createService(repository, credits, apple, new FakeGoogleVerifier());

    await service.verifyApplePurchase({ userId, signedTransaction: 'pending', environment: 'sandbox' });
    await service.verifyApplePurchase({ userId, signedTransaction: 'cancelled', environment: 'sandbox' });

    expect(credits.balance.purchasedCredits).toBe(0);
    expect(credits.ledger).toHaveLength(0);
  });

  it('refundでは残っている購入creditだけを一度取り消す', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const apple = new FakeAppleVerifier(
      applePurchase(),
      applePurchase({
        state: 'refunded',
        eventId: 'refund-event',
        observedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );
    const service = createService(repository, credits, apple, new FakeGoogleVerifier());

    await service.verifyApplePurchase({ userId, signedTransaction: 'active', environment: 'sandbox' });
    credits.balance = { ...credits.balance, purchasedCredits: 4 };
    const refunded = await service.verifyApplePurchase({
      userId,
      signedTransaction: 'refund',
      environment: 'sandbox',
    });
    const duplicate = await service.verifyApplePurchase({
      userId,
      signedTransaction: 'refund',
      environment: 'sandbox',
    });

    expect(refunded.creditsChanged).toBe(-4);
    expect(duplicate.creditsChanged).toBe(0);
    expect(credits.balance.purchasedCredits).toBe(0);
    expect(credits.ledger.map((entry) => entry.type)).toEqual([
      'purchase',
      'purchase_reversal',
    ]);
    expect(repository.purchases[0]).toMatchObject({
      grantedCredits: 10,
      reversedCredits: 4,
    });
  });

  it('別accountが同じprovider purchaseを送ると拒否する', async () => {
    const repository = new FakeStorePurchaseRepository([userId, otherUserId]);
    const credits = new FakeCreditRepository();
    const service = createService(
      repository,
      credits,
      new FakeAppleVerifier(applePurchase()),
      new FakeGoogleVerifier(),
    );

    await service.verifyApplePurchase({ userId, signedTransaction: 'first', environment: 'sandbox' });

    await expect(
      service.verifyApplePurchase({
        userId: otherUserId,
        signedTransaction: 'replay',
        environment: 'sandbox',
      }),
    ).rejects.toThrow('Store purchase belongs to another account');
    expect(credits.ledger).toHaveLength(1);
  });

  it('providerが返したaccount bindingが認証userと違う場合は初回購入でも拒否する', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const service = createService(
      repository,
      credits,
      new FakeAppleVerifier(applePurchase({ accountBinding: otherUserId })),
      new FakeGoogleVerifier(),
    );

    await expect(
      service.verifyApplePurchase({
        userId,
        signedTransaction: 'wrong-account-binding',
        environment: 'sandbox',
      }),
    ).rejects.toThrow('account binding does not match');
    expect(repository.purchases).toHaveLength(0);
    expect(credits.ledger).toHaveLength(0);
  });

  it('active Stripe consumer subscriptionがある場合はstore subscriptionを拒否する', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    repository.activeStripeUsers.add(userId);
    const service = createService(
      repository,
      new FakeCreditRepository(),
      new FakeAppleVerifier(appleSubscription()),
      new FakeGoogleVerifier(),
    );

    expect((await service.getAccountBinding(userId)).subscriptionPurchaseAllowed).toBe(false);
    await expect(
      service.verifyApplePurchase({
        userId,
        signedTransaction: 'subscription',
        environment: 'sandbox',
      }),
    ).rejects.toThrow('already has an active Stripe subscription');
  });

  it('cancelled subscriptionを期限まで維持しexpiredでplanを失効する', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const apple = new FakeAppleVerifier(
      appleSubscription(),
      appleSubscription({
        state: 'cancelled',
        eventId: 'cancelled',
        observedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
      appleSubscription({
        state: 'expired',
        eventId: 'expired',
        observedAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    );
    const service = createService(
      repository,
      new FakeCreditRepository(),
      apple,
      new FakeGoogleVerifier(),
    );

    await service.verifyApplePurchase({ userId, signedTransaction: 'active', environment: 'sandbox' });
    await service.verifyApplePurchase({
      userId,
      signedTransaction: 'cancelled',
      environment: 'sandbox',
    });
    expect(repository.users.get(userId)?.planCode).toBe('standard');

    await service.verifyApplePurchase({ userId, signedTransaction: 'expired', environment: 'sandbox' });
    expect(repository.users.get(userId)?.planCode).toBe('free');
  });

  it('subscription更新は新transactionだけを付与し過去期間のrefundで現期間を失効しない', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const currentExpiry = new Date('2026-09-30T00:00:00.000Z');
    const apple = new FakeAppleVerifier(
      appleSubscription(),
      appleSubscription({
        transactionId: 'apple-subscription-renewal',
        eventId: 'renewal',
        observedAt: new Date('2026-08-31T00:00:00.000Z'),
        expiresAt: currentExpiry,
      }),
      appleSubscription({
        transactionId: 'apple-subscription-transaction',
        eventId: 'historical-refund',
        state: 'refunded',
        observedAt: new Date('2026-09-01T00:00:00.000Z'),
        expiresAt: new Date('2026-08-31T00:00:00.000Z'),
      }),
    );
    const service = createService(
      repository,
      credits,
      apple,
      new FakeGoogleVerifier(),
    );

    await service.verifyApplePurchase({
      userId,
      signedTransaction: 'initial',
      environment: 'sandbox',
    });
    await service.verifyApplePurchase({
      userId,
      signedTransaction: 'renewal',
      environment: 'sandbox',
    });
    await service.verifyApplePurchase({
      userId,
      signedTransaction: 'historical-refund',
      environment: 'sandbox',
    });

    expect(repository.purchases[0]).toMatchObject({
      state: 'active',
      lastObservedAt: new Date('2026-08-31T00:00:00.000Z'),
    });
    expect(repository.users.get(userId)?.planCode).toBe('standard');
    expect(credits.balance.monthlyExpiresAt).toEqual(currentExpiry);
    expect(credits.ledger).toHaveLength(2);
  });

  it('Google client verifyと重複RTDNでcreditを一度だけ付与してprovider完了を再試行する', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const google = new FakeGoogleVerifier(googlePurchase());
    const service = createService(
      repository,
      credits,
      new FakeAppleVerifier(applePurchase()),
      google,
    );

    await service.verifyGooglePurchase({ userId, purchaseToken: 'raw-google-token' });
    const data = Buffer.from(
      JSON.stringify({
        version: '1.0',
        packageName: 'jp.lyra.app',
        eventTimeMillis: String(observedAt.getTime()),
        oneTimeProductNotification: {
          version: '1.0',
          notificationType: 1,
          purchaseToken: 'raw-google-token',
          sku: 'jp.lyra.google.credits.200',
        },
      }),
      'utf8',
    ).toString('base64');
    await service.handleGoogleRtdn({
      messageId: 'rtdn-1',
      data,
      publishTime: observedAt,
    });
    await service.handleGoogleRtdn({
      messageId: 'rtdn-1',
      data,
      publishTime: observedAt,
    });

    expect(credits.balance.purchasedCredits).toBe(10);
    expect(credits.ledger).toHaveLength(1);
    expect(google.completions).toHaveLength(3);
    expect(google.completions[0]).toEqual({
      purchaseToken: 'raw-google-token',
      productId: 'jp.lyra.google.credits.200',
      completion: 'consume',
    });
  });

  it('client verify後に同じApple notificationが重複してもcreditを二重付与しない', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const transaction = applePurchase({ eventId: null });
    const notification = applePurchase({ eventId: 'apple-notification-1' });
    const apple: AppleStorePurchaseVerifierPort = {
      async verifyTransaction() {
        return transaction;
      },
      async verifyNotification() {
        return notification;
      },
    };
    const service = createService(
      repository,
      credits,
      apple,
      new FakeGoogleVerifier(),
    );

    await service.verifyApplePurchase({
      userId,
      signedTransaction: 'client-verify',
      environment: 'sandbox',
    });
    await service.handleAppleNotification('signed-notification');
    await service.handleAppleNotification('signed-notification');

    expect(credits.balance.purchasedCredits).toBe(10);
    expect(credits.ledger).toHaveLength(1);
    expect(repository.purchases[0]?.grantedCredits).toBe(10);
  });

  it('Google linked purchaseを同じuserの旧subscription失効後に切り替える', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const google = new FakeGoogleVerifier(
      googleSubscription({ externalPurchaseId: 'old-token', linkedExternalPurchaseId: null }),
      googleSubscription({
        externalPurchaseId: 'new-token',
        linkedExternalPurchaseId: 'old-token',
        transactionId: 'new-order',
        productId: 'jp.lyra.google.premium.monthly',
      }),
    );
    const service = createService(
      repository,
      new FakeCreditRepository(),
      new FakeAppleVerifier(applePurchase()),
      google,
    );

    await service.verifyGooglePurchase({ userId, purchaseToken: 'old-token' });
    await service.verifyGooglePurchase({ userId, purchaseToken: 'new-token' });

    expect(repository.purchases).toHaveLength(2);
    expect(repository.purchases[0]?.state).toBe('expired');
    expect(repository.users.get(userId)?.planCode).toBe('premium');
  });
});

function createService(
  storePurchaseRepository: FakeStorePurchaseRepository,
  creditRepository: FakeCreditRepository,
  appleVerifier: AppleStorePurchaseVerifierPort,
  googleVerifier: FakeGoogleVerifier,
): MobileStorePurchaseService {
  return new MobileStorePurchaseService({
    storePurchaseRepository,
    creditRepository,
    productCatalog: createStoreProductCatalog([
      {
        store: 'apple',
        productId: 'jp.lyra.apple.credits.200',
        kind: 'credit_pack',
        creditPackageCode: 'credits_200',
      },
      {
        store: 'apple',
        productId: 'jp.lyra.apple.standard.monthly',
        kind: 'subscription',
        planCode: 'standard',
      },
      {
        store: 'google',
        productId: 'jp.lyra.google.credits.200',
        kind: 'credit_pack',
        creditPackageCode: 'credits_200',
      },
      {
        store: 'google',
        productId: 'jp.lyra.google.standard.monthly',
        kind: 'subscription',
        planCode: 'standard',
      },
      {
        store: 'google',
        productId: 'jp.lyra.google.premium.monthly',
        kind: 'subscription',
        planCode: 'premium',
      },
    ]),
    appleVerifier,
    googleVerifier,
    identifierSecret,
    allowAppleSandbox: true,
    allowGoogleTestPurchases: true,
    googlePackageName: 'jp.lyra.app',
    clock: () => observedAt,
  });
}

function applePurchase(
  overrides: Partial<VerifiedStorePurchase> = {},
): VerifiedStorePurchase {
  return {
    store: 'apple',
    environment: 'sandbox',
    productId: 'jp.lyra.apple.credits.200',
    externalPurchaseId: 'raw-original-id',
    linkedExternalPurchaseId: null,
    transactionId: 'raw-transaction-id',
    eventId: 'purchase-event',
    state: 'active',
    observedAt,
    expiresAt: null,
    autoRenewEnabled: null,
    accountBinding: userId,
    isTestPurchase: true,
    providerEventType: 'apple.transaction',
    providerCompletion: 'none',
    ...overrides,
  };
}

function appleSubscription(
  overrides: Partial<VerifiedStorePurchase> = {},
): VerifiedStorePurchase {
  return applePurchase({
    productId: 'jp.lyra.apple.standard.monthly',
    externalPurchaseId: 'apple-subscription-original',
    transactionId: 'apple-subscription-transaction',
    expiresAt: new Date('2026-08-31T00:00:00.000Z'),
    autoRenewEnabled: true,
    ...overrides,
  });
}

function googlePurchase(
  overrides: Partial<VerifiedStorePurchase> = {},
): VerifiedStorePurchase {
  return {
    store: 'google',
    environment: 'sandbox',
    productId: 'jp.lyra.google.credits.200',
    externalPurchaseId: 'raw-google-token',
    linkedExternalPurchaseId: null,
    transactionId: 'raw-google-order',
    eventId: null,
    state: 'active',
    observedAt,
    expiresAt: null,
    autoRenewEnabled: null,
    accountBinding: createGooglePlayObfuscatedAccountId(identifierSecret, userId),
    isTestPurchase: true,
    providerEventType: 'google.play.one_time',
    providerCompletion: 'consume',
    ...overrides,
  };
}

function googleSubscription(
  overrides: Partial<VerifiedStorePurchase> = {},
): VerifiedStorePurchase {
  return googlePurchase({
    productId: 'jp.lyra.google.standard.monthly',
    transactionId: 'google-subscription-order',
    expiresAt: new Date('2026-08-31T00:00:00.000Z'),
    autoRenewEnabled: true,
    providerEventType: 'google.play.subscription',
    providerCompletion: 'acknowledge',
    ...overrides,
  });
}

class FakeAppleVerifier implements AppleStorePurchaseVerifierPort {
  private index = 0;
  private readonly purchases: VerifiedStorePurchase[];

  public constructor(...purchases: VerifiedStorePurchase[]) {
    this.purchases = purchases;
  }

  public async verifyTransaction(): Promise<VerifiedStorePurchase> {
    const purchase = this.purchases[Math.min(this.index, this.purchases.length - 1)];
    this.index += 1;
    if (purchase === undefined) {
      throw new Error('Apple fixture missing');
    }
    return purchase;
  }

  public async verifyNotification(): Promise<VerifiedStorePurchase | null> {
    return this.purchases[0] ?? null;
  }
}

class FakeGoogleVerifier implements GooglePlayPurchaseVerifierPort {
  private index = 0;
  public readonly completions: GoogleProviderCompletionInput[] = [];
  private readonly purchases: VerifiedStorePurchase[];

  public constructor(...purchases: VerifiedStorePurchase[]) {
    this.purchases = purchases;
  }

  public async verifyPurchase(): Promise<VerifiedStorePurchase> {
    const purchase = this.purchases[Math.min(this.index, this.purchases.length - 1)];
    this.index += 1;
    if (purchase === undefined) {
      throw new Error('Google fixture missing');
    }
    return purchase;
  }

  public async completePurchase(input: GoogleProviderCompletionInput): Promise<void> {
    this.completions.push(input);
  }
}

class FakeStorePurchaseRepository implements StorePurchaseRepository {
  public readonly users = new Map<string, StorePurchaseUserRecord>();
  public readonly deletedUsers = new Set<string>();
  public readonly activeStripeUsers = new Set<string>();
  public readonly purchases: StorePurchaseRecord[] = [];
  public readonly events: StorePurchaseEventInput[] = [];
  private nextId = 1;

  public constructor(userIds: string[]) {
    for (const id of userIds) {
      this.users.set(id, { id, planCode: 'free', accountDeleted: false });
    }
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(new NoopDatabaseClient());
  }

  public async lockPurchaseKey(): Promise<void> {}

  public async findUserForUpdate(userId: string): Promise<StorePurchaseUserRecord | null> {
    const user = this.users.get(userId);
    return user === undefined
      ? null
      : ({
          ...user,
          accountDeleted: this.deletedUsers.has(userId),
        } as StorePurchaseUserRecord);
  }

  public async findPurchaseForUpdate(
    store: 'apple' | 'google',
    externalPurchaseKey: string,
  ): Promise<StorePurchaseRecord | null> {
    return (
      this.purchases.find(
        (purchase) =>
          purchase.store === store &&
          purchase.externalPurchaseKey === externalPurchaseKey,
      ) ?? null
    );
  }

  public async createPurchase(input: CreateStorePurchaseInput): Promise<StorePurchaseRecord> {
    const record: StorePurchaseRecord = {
      id: `purchase-${this.nextId++}`,
      ...input,
      grantedCredits: 0,
      reversedCredits: 0,
    };
    this.purchases.push(record);
    return record;
  }

  public async updatePurchase(
    purchaseId: string,
    input: UpdateStorePurchaseInput,
  ): Promise<StorePurchaseRecord> {
    const purchase = this.requirePurchase(purchaseId);
    purchase.state = input.state;
    purchase.transactionKey = input.transactionKey ?? purchase.transactionKey;
    purchase.expiresAt = input.expiresAt;
    purchase.autoRenewEnabled = input.autoRenewEnabled;
    purchase.lastObservedAt = input.lastObservedAt;
    return purchase;
  }

  public async recordEventIfNew(input: StorePurchaseEventInput): Promise<boolean> {
    const duplicate = this.events.some(
      (event) =>
        event.store === input.store &&
        (event.eventKey === input.eventKey ||
          (event.transactionKey !== null &&
            input.transactionKey !== null &&
            event.transactionKey === input.transactionKey &&
            event.operation === input.operation)),
    );
    if (duplicate) {
      return false;
    }
    this.events.push(input);
    return true;
  }

  public async addGrantedCredits(purchaseId: string, amount: number): Promise<void> {
    this.requirePurchase(purchaseId).grantedCredits += amount;
  }

  public async addReversedCredits(purchaseId: string, amount: number): Promise<void> {
    this.requirePurchase(purchaseId).reversedCredits += amount;
  }

  public async hasActiveStripeConsumerSubscription(userId: string): Promise<boolean> {
    return this.activeStripeUsers.has(userId);
  }

  public async resolvePersonalPlan(
    userId: string,
  ): Promise<'standard' | 'premium' | null> {
    const active = this.purchases
      .filter(
        (purchase) =>
          purchase.userId === userId &&
          purchase.kind === 'subscription' &&
          (purchase.state === 'active' ||
            (purchase.state === 'cancelled' &&
              purchase.expiresAt !== null &&
              purchase.expiresAt > observedAt)),
      )
      .map((purchase) => purchase.planCode);
    return active.includes('premium')
      ? 'premium'
      : active.includes('standard')
        ? 'standard'
        : null;
  }

  public async updatePersonalPlan(
    userId: string,
    planCode: 'free' | 'standard' | 'premium',
  ): Promise<void> {
    const user = this.users.get(userId);
    if (user !== undefined) {
      user.planCode = planCode;
    }
  }

  public async findLatestStoreSubscriptionForUser(
    userId: string,
  ): Promise<StoreSubscriptionSummaryRecord | null> {
    const purchase = this.purchases.find(
      (entry) =>
        entry.userId === userId &&
        entry.kind === 'subscription' &&
        (entry.state === 'active' || entry.state === 'cancelled'),
    );
    if (purchase?.planCode === null || purchase === undefined) {
      return null;
    }
    return {
      planCode: purchase.planCode,
      state: purchase.state as 'active' | 'cancelled',
      expiresAt: purchase.expiresAt,
      autoRenewEnabled: purchase.autoRenewEnabled,
    };
  }

  private requirePurchase(purchaseId: string): StorePurchaseRecord {
    const purchase = this.purchases.find((entry) => entry.id === purchaseId);
    if (purchase === undefined) {
      throw new Error('purchase missing');
    }
    return purchase;
  }
}

class FakeCreditRepository implements CreditRepository {
  public balance: CreditBalance = {
    userId,
    monthlyCredits: 0,
    purchasedCredits: 0,
    monthlyExpiresAt: null,
  };
  public readonly ledger: CreditLedgerEntry[] = [];

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(new NoopDatabaseClient());
  }

  public async getBalance(): Promise<CreditBalance | null> {
    return this.balance;
  }

  public async getBalanceForUpdate(): Promise<CreditBalance | null> {
    return this.balance;
  }

  public async createBalance(balance: CreditBalance): Promise<CreditBalance> {
    this.balance = balance;
    return balance;
  }

  public async updateBalance(balance: CreditBalance): Promise<CreditBalance> {
    this.balance = balance;
    return balance;
  }

  public async hasLedgerEntry(): Promise<boolean> {
    return false;
  }

  public async countJobLedgerEntries(): Promise<number> {
    return 0;
  }

  public async sumJobLedgerAmount(): Promise<number> {
    return 0;
  }

  public async sumJobLedgerBucketDeltas(): Promise<CreditLedgerBucketDeltaSummary> {
    return {
      monthlyDelta: 0,
      purchasedDelta: 0,
      entryCount: 0,
      completeEntryCount: 0,
    };
  }

  public async insertLedger(entry: CreditLedgerEntry): Promise<void> {
    this.ledger.push(entry);
  }
}

class NoopDatabaseClient implements DatabaseClient {
  public async query<T extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<T>> {
    return {
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: [],
    };
  }
}
