import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createGooglePlayObfuscatedAccountId,
  createStoreProductCatalog,
  type VerifiedStorePurchase,
} from '../../../../src/domain/storePurchase.js';
import type { CreditBalance, CreditLedgerEntry } from '../../../../src/domain/types/credit.js';
import type { DatabaseClient } from '../../../../src/lib/db.js';
import type { CreditLedgerBucketDeltaSummary, CreditRepository } from '../../../../src/repositories/CreditRepository.js';
import type {
  CreateStorePurchaseInput,
  StorePurchaseEventInput,
  StorePurchaseRecord,
  StorePurchaseRepository,
  StorePurchaseUserRecord,
  UpdateStorePurchaseInput,
} from '../../../../src/repositories/StorePurchaseRepository.js';
import {
  MobileStorePurchaseService,
  type AppleStorePurchaseVerifierPort,
  type GooglePlayPurchaseVerifierPort,
} from '../../../../src/services/billing/MobileStorePurchaseService.js';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const identifierSecret = '01234567890123456789012345678901';
const observedAt = new Date('2026-07-25T00:00:00.000Z');

describe('MobileStorePurchaseService', () => {
  it('returns only the configured products for the requested mobile store', () => {
    const service = createService(
      new FakeStorePurchaseRepository([userId]),
      new FakeCreditRepository(),
      new FakeAppleVerifier(),
      new FakeGoogleVerifier(),
    );

    expect(service.listProducts('apple')).toEqual([
      {
        store: 'apple',
        productId: 'jp.lyra.credits.200',
        kind: 'credit_pack',
        creditPackageCode: 'credits_200',
      },
      {
        store: 'apple',
        productId: 'jp.lyra.standard.monthly',
        kind: 'subscription',
        planCode: 'standard',
      },
    ]);
  });

  it('grants a personal credit pack once and records only keyed identifiers', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const apple = new FakeAppleVerifier(applePurchase({ state: 'active' }));
    const service = createService(repository, credits, apple, new FakeGoogleVerifier());

    const first = await service.verifyApplePurchase({
      userId,
      signedTransaction: 'signed.transaction.not.persisted',
      environment: 'sandbox',
    });
    const second = await service.verifyApplePurchase({
      userId,
      signedTransaction: 'signed.transaction.not.persisted',
      environment: 'sandbox',
    });

    expect(first).toMatchObject({ creditsChanged: 10, isDuplicate: false, state: 'active' });
    expect(second).toMatchObject({ creditsChanged: 0, isDuplicate: true });
    expect(credits.balance).toMatchObject({ purchasedCredits: 10 });
    expect(credits.ledger).toHaveLength(1);
    expect(credits.ledger[0]).toMatchObject({ type: 'purchase', amount: 10 });
    expect(repository.purchases[0]?.externalPurchaseKey).not.toContain('apple-original-token');
    expect(repository.events.every((event) => !event.eventKey.includes('apple-transaction-1'))).toBe(true);
  });

  it('Apple検証器が確認した実環境を採用し誤ったクライアント環境ヒントを信用しない', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const service = createService(
      repository,
      credits,
      new FakeAppleVerifier(applePurchase({ environment: 'sandbox' })),
      new FakeGoogleVerifier(),
    );

    await expect(service.verifyApplePurchase({
      userId,
      signedTransaction: 'signed.sandbox.transaction',
      environment: 'production',
    })).resolves.toMatchObject({ creditsChanged: 10, isDuplicate: false });
    expect(credits.balance.purchasedCredits).toBe(10);
  });

  it('実際のApple環境がSandboxの場合はSandbox無効設定で付与しない', async () => {
    const credits = new FakeCreditRepository();
    const service = createService(
      new FakeStorePurchaseRepository([userId]),
      credits,
      new FakeAppleVerifier(applePurchase({ environment: 'sandbox' })),
      new FakeGoogleVerifier(),
      { allowAppleSandbox: false },
    );

    await expect(service.verifyApplePurchase({
      userId,
      signedTransaction: 'signed.sandbox.transaction',
      environment: 'production',
    })).rejects.toThrow('Store purchase could not be verified');
    expect(credits.ledger).toHaveLength(0);
  });

  it('reverses only the remaining credited balance once after a newer refund event', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const apple = new FakeAppleVerifier(
      applePurchase({ state: 'active' }),
      applePurchase({
        state: 'refunded',
        observedAt: new Date('2026-07-26T00:00:00.000Z'),
        eventId: 'refund-event-1',
      }),
    );
    const service = createService(repository, credits, apple, new FakeGoogleVerifier());

    await service.verifyApplePurchase({ userId, signedTransaction: 'active', environment: 'sandbox' });
    const refunded = await service.verifyApplePurchase({ userId, signedTransaction: 'refund', environment: 'sandbox' });
    const duplicate = await service.verifyApplePurchase({ userId, signedTransaction: 'refund', environment: 'sandbox' });

    expect(refunded).toMatchObject({ state: 'refunded', creditsChanged: -10, isDuplicate: false });
    expect(duplicate).toMatchObject({ state: 'refunded', creditsChanged: 0, isDuplicate: true });
    expect(credits.balance).toMatchObject({ purchasedCredits: 0 });
    expect(credits.ledger.map((entry) => entry.type)).toEqual(['purchase', 'purchase_reversal']);
  });

  it('rejects a personal purchase record when another authenticated account submits it', async () => {
    const repository = new FakeStorePurchaseRepository([userId, otherUserId]);
    const credits = new FakeCreditRepository();
    const apple = new FakeAppleVerifier(applePurchase({ state: 'active' }));
    const service = createService(repository, credits, apple, new FakeGoogleVerifier());

    await service.verifyApplePurchase({ userId, signedTransaction: 'original', environment: 'sandbox' });

    await expect(
      service.verifyApplePurchase({
        userId: otherUserId,
        signedTransaction: 'original',
        environment: 'sandbox',
      }),
    ).rejects.toThrow('Store purchase belongs to another account');
    expect(credits.ledger).toHaveLength(1);
  });

  it('keeps a cancelled subscription entitled through expiry and removes it after expiry', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const apple = new FakeAppleVerifier(
      appleSubscription({ state: 'active' }),
      appleSubscription({
        state: 'cancelled',
        observedAt: new Date('2026-07-26T00:00:00.000Z'),
      }),
      appleSubscription({
        state: 'expired',
        observedAt: new Date('2026-08-26T00:00:00.000Z'),
      }),
    );
    const service = createService(repository, credits, apple, new FakeGoogleVerifier());

    await service.verifyApplePurchase({ userId, signedTransaction: 'active', environment: 'sandbox' });
    await service.verifyApplePurchase({ userId, signedTransaction: 'cancelled', environment: 'sandbox' });
    expect(repository.users.get(userId)?.planCode).toBe('standard');

    await service.verifyApplePurchase({ userId, signedTransaction: 'expired', environment: 'sandbox' });
    expect(repository.users.get(userId)?.planCode).toBe('free');
  });

  it('does not grant again when Google RTDN repeats a purchase already submitted by the client', async () => {
    const repository = new FakeStorePurchaseRepository([userId]);
    const credits = new FakeCreditRepository();
    const googlePurchase: VerifiedStorePurchase = {
      store: 'google',
      environment: 'sandbox',
      productId: 'jp.lyra.credits.200',
      externalPurchaseId: 'google-purchase-token',
      transactionId: 'GPA.1000-2000',
      eventId: null,
      state: 'active',
      observedAt,
      expiresAt: null,
      autoRenewEnabled: null,
      accountBinding: createGooglePlayObfuscatedAccountId(identifierSecret, userId),
      isTestPurchase: true,
      providerEventType: 'google.play.one_time',
    };
    const service = createService(
      repository,
      credits,
      new FakeAppleVerifier(applePurchase({ state: 'active' })),
      new FakeGoogleVerifier(googlePurchase),
    );

    await service.verifyGooglePurchase({ userId, purchaseToken: 'google-purchase-token' });
    const rtdn = Buffer.from(
      JSON.stringify({
        version: '1.0',
        packageName: 'jp.lyra.app',
        eventTimeMillis: String(observedAt.getTime()),
        oneTimeProductNotification: {
          version: '1.0',
          notificationType: 1,
          purchaseToken: 'google-purchase-token',
          sku: 'jp.lyra.credits.200',
        },
      }),
      'utf8',
    ).toString('base64');
    await service.handleGoogleRtdn({ messageId: 'rtdn-1', data: rtdn, publishTime: observedAt });
    await service.handleGoogleRtdn({ messageId: 'rtdn-1', data: rtdn, publishTime: observedAt });

    expect(credits.balance.purchasedCredits).toBe(10);
    expect(credits.ledger).toHaveLength(1);
  });

  it('Googleテスト購入は期限内のallowlist利用者だけに反映する', async () => {
    const allowedRepository = new FakeStorePurchaseRepository([userId]);
    const allowedCredits = new FakeCreditRepository();
    const allowedPurchase = googleTestPurchase(userId);
    const allowedService = createService(
      allowedRepository,
      allowedCredits,
      new FakeAppleVerifier(),
      new FakeGoogleVerifier(allowedPurchase),
      {
        googleTestPurchaseAllowedUserIds: new Set([userId]),
        googleTestPurchasesExpireAt: new Date('2026-07-26T00:00:00.000Z')
      }
    );

    await expect(
      allowedService.verifyGooglePurchase({ userId, purchaseToken: 'allowed-test-token' })
    ).resolves.toMatchObject({ creditsChanged: 10, isDuplicate: false });

    const deniedRepository = new FakeStorePurchaseRepository([otherUserId]);
    const deniedCredits = new FakeCreditRepository();
    const deniedService = createService(
      deniedRepository,
      deniedCredits,
      new FakeAppleVerifier(),
      new FakeGoogleVerifier(googleTestPurchase(otherUserId)),
      {
        googleTestPurchaseAllowedUserIds: new Set([userId]),
        googleTestPurchasesExpireAt: new Date('2026-07-26T00:00:00.000Z')
      }
    );

    await expect(
      deniedService.verifyGooglePurchase({ userId: otherUserId, purchaseToken: 'denied-test-token' })
    ).rejects.toThrow('Store purchase could not be verified');
    expect(deniedCredits.ledger).toHaveLength(0);
  });

  it('Googleテスト購入はallowlist利用者でも期限切れなら反映しない', async () => {
    const credits = new FakeCreditRepository();
    const service = createService(
      new FakeStorePurchaseRepository([userId]),
      credits,
      new FakeAppleVerifier(),
      new FakeGoogleVerifier(googleTestPurchase(userId)),
      {
        googleTestPurchaseAllowedUserIds: new Set([userId]),
        googleTestPurchasesExpireAt: observedAt,
      },
    );

    await expect(
      service.verifyGooglePurchase({ userId, purchaseToken: 'expired-test-token' }),
    ).rejects.toThrow('Store purchase could not be verified');
    expect(credits.ledger).toHaveLength(0);
  });

  it('Googleテスト購入のRTDNはallowlist利用者のアカウント紐付けだけ反映する', async () => {
    const credits = new FakeCreditRepository();
    const service = createService(
      new FakeStorePurchaseRepository([otherUserId]),
      credits,
      new FakeAppleVerifier(),
      new FakeGoogleVerifier(googleTestPurchase(otherUserId)),
      {
        googleTestPurchaseAllowedUserIds: new Set([userId]),
        googleTestPurchasesExpireAt: new Date('2026-07-26T00:00:00.000Z'),
      },
    );
    const rtdn = Buffer.from(
      JSON.stringify({
        packageName: 'jp.lyra.app',
        eventTimeMillis: String(observedAt.getTime()),
        oneTimeProductNotification: { notificationType: 1, purchaseToken: 'denied-rtdn-token' },
      }),
      'utf8',
    ).toString('base64');

    await service.handleGoogleRtdn({ messageId: 'denied-rtdn', data: rtdn, publishTime: observedAt });

    expect(credits.ledger).toHaveLength(0);
  });
});

interface TestPurchasePolicyOverrides {
  allowAppleSandbox?: boolean;
  googleTestPurchaseAllowedUserIds?: ReadonlySet<string>;
  googleTestPurchasesExpireAt?: Date;
}

function createService(
  storePurchaseRepository: FakeStorePurchaseRepository,
  creditRepository: FakeCreditRepository,
  appleVerifier: FakeAppleVerifier,
  googleVerifier: FakeGoogleVerifier,
  policy: TestPurchasePolicyOverrides = {},
): MobileStorePurchaseService {
  return new MobileStorePurchaseService({
    storePurchaseRepository,
    creditRepository,
    productCatalog: createStoreProductCatalog([
      { store: 'apple', productId: 'jp.lyra.credits.200', kind: 'credit_pack', creditPackageCode: 'credits_200' },
      { store: 'apple', productId: 'jp.lyra.standard.monthly', kind: 'subscription', planCode: 'standard' },
      { store: 'google', productId: 'jp.lyra.credits.200', kind: 'credit_pack', creditPackageCode: 'credits_200' },
    ]),
    appleVerifier,
    googleVerifier,
    identifierSecret,
    allowAppleSandbox: policy.allowAppleSandbox ?? true,
    allowGoogleTestPurchases: true,
    googleTestPurchaseAllowedUserIds: policy.googleTestPurchaseAllowedUserIds,
    googleTestPurchasesExpireAt: policy.googleTestPurchasesExpireAt,
    googlePackageName: 'jp.lyra.app',
    clock: () => observedAt,
  });
}

function googleTestPurchase(bindingUserId: string): VerifiedStorePurchase {
  return {
    store: 'google',
    environment: 'sandbox',
    productId: 'jp.lyra.credits.200',
    externalPurchaseId: `google-test-${bindingUserId}`,
    transactionId: `GPA.TEST-${bindingUserId}`,
    eventId: null,
    state: 'active',
    observedAt,
    expiresAt: null,
    autoRenewEnabled: null,
    accountBinding: createGooglePlayObfuscatedAccountId(identifierSecret, bindingUserId),
    isTestPurchase: true,
    providerEventType: 'google.play.one_time',
  };
}

function applePurchase(overrides: Partial<VerifiedStorePurchase>): VerifiedStorePurchase {
  return {
    store: 'apple',
    environment: 'sandbox',
    productId: 'jp.lyra.credits.200',
    externalPurchaseId: 'apple-original-token',
    transactionId: 'apple-transaction-1',
    eventId: null,
    state: 'active',
    observedAt,
    expiresAt: null,
    autoRenewEnabled: null,
    accountBinding: userId,
    isTestPurchase: true,
    providerEventType: 'apple.transaction',
    ...overrides,
  };
}

function appleSubscription(overrides: Partial<VerifiedStorePurchase>): VerifiedStorePurchase {
  return {
    ...applePurchase({
      productId: 'jp.lyra.standard.monthly',
      externalPurchaseId: 'apple-subscription-original',
      transactionId: 'apple-subscription-transaction',
      expiresAt: new Date('2026-08-25T00:00:00.000Z'),
      autoRenewEnabled: true,
    }),
    ...overrides,
  };
}

class FakeAppleVerifier implements AppleStorePurchaseVerifierPort {
  private index = 0;
  private readonly purchases: VerifiedStorePurchase[];

  public constructor(...purchases: VerifiedStorePurchase[]) {
    this.purchases = purchases;
  }

  public async verifyTransaction(_input: { signedTransaction: string; environment: 'sandbox' | 'production' }): Promise<VerifiedStorePurchase> {
    const purchase = this.purchases[Math.min(this.index, this.purchases.length - 1)];
    this.index += 1;
    return purchase;
  }

  public async verifyNotification(_signedPayload: string): Promise<VerifiedStorePurchase | null> {
    return null;
  }
}

class FakeGoogleVerifier implements GooglePlayPurchaseVerifierPort {
  public constructor(private readonly purchase?: VerifiedStorePurchase) {}

  public async verifyPurchase(_input: { purchaseToken: string }): Promise<VerifiedStorePurchase> {
    if (this.purchase === undefined) {
      throw new Error('not used');
    }
    return this.purchase;
  }
}

class FakeStorePurchaseRepository implements StorePurchaseRepository {
  public readonly users = new Map<string, StorePurchaseUserRecord>();
  public readonly purchases: StorePurchaseRecord[] = [];
  public readonly events: StorePurchaseEventInput[] = [];
  private nextId = 1;

  public constructor(userIds: string[]) {
    for (const id of userIds) {
      this.users.set(id, { id, planCode: 'free' });
    }
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(new NoopDatabaseClient());
  }

  public async lockPurchaseKey(
    _store: 'apple' | 'google',
    _externalPurchaseKey: string,
    _client: DatabaseClient,
  ): Promise<void> {}

  public async findUserForUpdate(userId: string, _client: DatabaseClient): Promise<StorePurchaseUserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  public async findPurchaseForUpdate(
    store: 'apple' | 'google',
    externalPurchaseKey: string,
    _client: DatabaseClient,
  ): Promise<StorePurchaseRecord | null> {
    return this.purchases.find((purchase) => purchase.store === store && purchase.externalPurchaseKey === externalPurchaseKey) ?? null;
  }

  public async createPurchase(input: CreateStorePurchaseInput, _client: DatabaseClient): Promise<StorePurchaseRecord> {
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
    _client: DatabaseClient,
  ): Promise<StorePurchaseRecord> {
    const purchase = this.purchases.find((entry) => entry.id === purchaseId);
    if (purchase === undefined) {
      throw new Error('purchase missing');
    }
    purchase.state = input.state;
    purchase.transactionKey = input.transactionKey ?? purchase.transactionKey;
    purchase.expiresAt = input.expiresAt;
    purchase.autoRenewEnabled = input.autoRenewEnabled;
    purchase.lastObservedAt = input.lastObservedAt;
    return purchase;
  }

  public async recordEventIfNew(input: StorePurchaseEventInput, _client: DatabaseClient): Promise<boolean> {
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

  public async addGrantedCredits(purchaseId: string, amount: number, _client: DatabaseClient): Promise<void> {
    const purchase = this.requirePurchase(purchaseId);
    purchase.grantedCredits += amount;
  }

  public async addReversedCredits(purchaseId: string, amount: number, _client: DatabaseClient): Promise<void> {
    const purchase = this.requirePurchase(purchaseId);
    purchase.reversedCredits += amount;
  }

  public async hasActiveStripeConsumerSubscription(_userId: string, _client: DatabaseClient): Promise<boolean> {
    return false;
  }

  public async resolvePersonalPlan(userId: string, _client: DatabaseClient): Promise<'standard' | 'premium' | null> {
    const active = this.purchases
      .filter(
        (purchase) =>
          purchase.userId === userId &&
          purchase.kind === 'subscription' &&
          (purchase.state === 'active' ||
            (purchase.state === 'cancelled' && purchase.expiresAt !== null && purchase.expiresAt > observedAt)),
      )
      .map((purchase) => purchase.planCode)
      .filter((planCode): planCode is 'standard' | 'premium' => planCode !== null);
    return active.includes('premium') ? 'premium' : active.includes('standard') ? 'standard' : null;
  }

  public async updatePersonalPlan(
    userId: string,
    planCode: 'free' | 'standard' | 'premium',
    _client: DatabaseClient,
  ): Promise<void> {
    const user = this.users.get(userId);
    if (user !== undefined) {
      user.planCode = planCode;
    }
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

  public async getBalance(_userId: string, _client?: DatabaseClient): Promise<CreditBalance | null> {
    return this.balance;
  }

  public async getBalanceForUpdate(_userId: string, _client: DatabaseClient): Promise<CreditBalance | null> {
    return this.balance;
  }

  public async createBalance(balance: CreditBalance, _client: DatabaseClient): Promise<CreditBalance> {
    this.balance = balance;
    return balance;
  }

  public async updateBalance(balance: CreditBalance, _client: DatabaseClient): Promise<CreditBalance> {
    this.balance = balance;
    return balance;
  }

  public async hasLedgerEntry(_userId: string, _type: CreditLedgerEntry['type'], _client: DatabaseClient): Promise<boolean> {
    return false;
  }

  public async countJobLedgerEntries(
    _userId: string,
    _type: CreditLedgerEntry['type'],
    _jobId: string,
    _client: DatabaseClient,
  ): Promise<number> {
    return 0;
  }

  public async sumJobLedgerAmount(
    _userId: string,
    _type: CreditLedgerEntry['type'],
    _jobId: string,
    _client: DatabaseClient,
  ): Promise<number> {
    return 0;
  }

  public async sumJobLedgerBucketDeltas(
    _userId: string,
    _type: CreditLedgerEntry['type'],
    _jobId: string,
    _client: DatabaseClient,
  ): Promise<CreditLedgerBucketDeltaSummary> {
    return { monthlyDelta: 0, purchasedDelta: 0, entryCount: 0, completeEntryCount: 0 };
  }

  public async insertLedger(entry: CreditLedgerEntry, _client: DatabaseClient): Promise<void> {
    this.ledger.push(entry);
  }
}

class NoopDatabaseClient implements DatabaseClient {
  public async query<T extends QueryResultRow = QueryResultRow>(
    _text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return { command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [] };
  }
}
