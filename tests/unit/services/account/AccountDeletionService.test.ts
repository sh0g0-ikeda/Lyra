import { describe, expect, it } from 'vitest';
import type { AccountDeletionRepository } from '../../../../src/repositories/AccountDeletionRepository.js';
import {
  AccountDeletionService,
  createUnavailableAccountAssetLifecyclePort,
  createUnavailableAccountIdentityDeletionPort,
  type AccountAssetLifecyclePort,
  type AccountIdentityDeletionPort,
  type AccountSubscriptionCancellationPort,
} from '../../../../src/services/account/AccountDeletionService.js';

const userId = '11111111-1111-4111-8111-111111111111';
const identityId = 'cognito-subject-1';

describe('AccountDeletionService', () => {
  it('唯一 owner の法人がある場合は削除を開始せず blocker を返す', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    repository.flight.uniqueOwnerOrganizations = [
      { id: '22222222-2222-4222-8222-222222222222', name: 'Lyra Studio' },
    ];
    const subscriptions = new FakeSubscriptionCancellationPort();
    const identity = new FakeIdentityDeletionPort();
    const assets = new FakeAssetLifecyclePort();
    const service = new AccountDeletionService(repository, subscriptions, identity, assets);

    const result = await service.requestDeletion(confirmedRequest());

    expect(result).toEqual({
      status: 'blocked',
      blockers: [
        {
          code: 'UNIQUE_ORGANIZATION_OWNER',
          organizations: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Lyra Studio' }],
        },
      ],
    });
    expect(subscriptions.cancelled).toEqual([]);
    expect(identity.events).toEqual([]);
    expect(assets.scheduledKeys).toEqual([]);
    expect(repository.anonymizedUserIds).toEqual([]);
  });

  it('確認がない subscription と asset は blocker として返す', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    repository.flight.activePersonalSubscriptionIds = ['sub_123'];
    repository.flight.activeMobileStoreSubscriptionCount = 1;
    repository.flight.confirmedAssetCount = 3;
    const service = new AccountDeletionService(
      repository,
      new FakeSubscriptionCancellationPort(),
      new FakeIdentityDeletionPort(),
      new FakeAssetLifecyclePort(),
    );

    const result = await service.requestDeletion({
      ...confirmedRequest(),
      acknowledgeActiveSubscription: false,
      acknowledgeConfirmedAssets: false,
    });

    expect(result).toEqual({
      status: 'blocked',
      blockers: [
        { code: 'ACTIVE_PERSONAL_SUBSCRIPTION', subscription_count: 2 },
        { code: 'CONFIRMED_PERSONAL_ASSETS', asset_count: 3 },
      ],
    });
  });

  it('モバイルストアの有効な定期購入も削除前の確認件数に含める', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    repository.flight.activeMobileStoreSubscriptionCount = 2;
    const subscriptions = new FakeSubscriptionCancellationPort();
    const service = new AccountDeletionService(
      repository,
      subscriptions,
      new FakeIdentityDeletionPort(),
      new FakeAssetLifecyclePort(),
    );

    const preview = await service.getDeletionPreview(userId);
    const blocked = await service.requestDeletion({
      ...confirmedRequest(),
      acknowledgeActiveSubscription: false,
    });

    expect(preview.activePersonalSubscriptionCount).toBe(2);
    expect(blocked).toEqual({
      status: 'blocked',
      blockers: [{ code: 'ACTIVE_PERSONAL_SUBSCRIPTION', subscription_count: 2 }],
    });
    expect(subscriptions.cancelled).toEqual([]);
  });

  it('確認済みの削除では provider と DB を安全な順序で一度ずつ実行する', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    repository.flight.activePersonalSubscriptionIds = ['sub_123'];
    repository.flight.confirmedAssetCount = 2;
    repository.flight.personalAssetKeys = [
      'saved/user-1/entities/entity-1/ref-1.png',
      'saved/user-1/pages/page-1_final.png',
    ];
    const events: string[] = [];
    const service = new AccountDeletionService(
      repository,
      new FakeSubscriptionCancellationPort(events),
      new FakeIdentityDeletionPort(events),
      new FakeAssetLifecyclePort(events),
    );
    repository.events = events;

    const result = await service.requestDeletion(confirmedRequest());

    expect(result).toEqual({ status: 'completed', blockers: [] });
    expect(events).toEqual([
      'stripe:sub_123',
      's3:saved/user-1/entities/entity-1/ref-1.png',
      's3:saved/user-1/pages/page-1_final.png',
      `db:${userId}`,
      `cognito:disable:${identityId}`,
      `cognito:delete:${identityId}`,
    ]);
  });

  it('削除プレビューでは本人の削除対象だけを副作用なしで返す', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    repository.flight.uniqueOwnerOrganizations = Array.from({ length: 30 }, (_, index) => ({
      id: `organization-${index}`,
      name: `Organization ${index}`,
    }));
    repository.flight.activePersonalSubscriptionIds = ['sub_123', 'sub_456'];
    repository.flight.confirmedAssetCount = 4;
    const service = new AccountDeletionService(
      repository,
      new FakeSubscriptionCancellationPort(),
      new FakeIdentityDeletionPort(),
      new FakeAssetLifecyclePort(),
    );

    const preview = await service.getDeletionPreview(userId);

    expect(preview).toMatchObject({
      personalData: {
        account: 'anonymized',
        personalWorks: 'deleted',
        organizationMemberships: 'removed',
      },
      activePersonalSubscriptionCount: 2,
      activeStripeSubscriptionCount: 2,
      activeMobileStoreSubscriptionCount: 0,
      confirmedPersonalAssetCount: 4,
    });
    expect(preview.uniqueOwnerOrganizations).toHaveLength(25);
    expect(repository.getFlightCalls).toBe(1);
    expect(repository.claimCalls).toBe(0);
    expect(repository.anonymizedUserIds).toEqual([]);
  });

  it('asset lifecycle が失敗した場合は identity を無効化も削除もしない', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    repository.flight.personalAssetKeys = ['saved/user-1/pages/page-1_final.png'];
    const identity = new FakeIdentityDeletionPort();
    const assets = new FakeAssetLifecyclePort();
    assets.failOnce = true;
    const service = new AccountDeletionService(
      repository,
      new FakeSubscriptionCancellationPort(),
      identity,
      assets,
    );

    const result = await service.requestDeletion(confirmedRequest());

    expect(result).toEqual({
      status: 'pending_external_action',
      blockers: [],
      next_action: 'schedule_asset_lifecycle',
    });
    expect(identity.events).toEqual([]);
    expect(repository.anonymizedUserIds).toEqual([]);
  });

  it('未設定の external adapter は削除完了として扱わない', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    repository.flight.personalAssetKeys = ['saved/user-1/pages/page-1_final.png'];
    const service = new AccountDeletionService(
      repository,
      new FakeSubscriptionCancellationPort(),
      new FakeIdentityDeletionPort(),
      createUnavailableAccountAssetLifecyclePort(),
    );

    const result = await service.requestDeletion(confirmedRequest());

    expect(result).toEqual({
      status: 'pending_external_action',
      blockers: [],
      next_action: 'schedule_asset_lifecycle',
    });
    expect(repository.anonymizedUserIds).toEqual([]);
  });

  it('未設定の identity adapter も削除完了として扱わない', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    const service = new AccountDeletionService(
      repository,
      new FakeSubscriptionCancellationPort(),
      createUnavailableAccountIdentityDeletionPort(),
      new FakeAssetLifecyclePort(),
    );

    const result = await service.requestDeletion(confirmedRequest());

    expect(result).toEqual({
      status: 'pending_external_action',
      blockers: [],
      next_action: 'disable_identity',
    });
  });

  it('identity delete が失敗しても raw provider error を返さず再試行できる', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    const identity = new FakeIdentityDeletionPort();
    identity.failDeleteOnce = true;
    const service = new AccountDeletionService(
      repository,
      new FakeSubscriptionCancellationPort(),
      identity,
      new FakeAssetLifecyclePort(),
    );

    const first = await service.requestDeletion(confirmedRequest());

    expect(first).toEqual({
      status: 'pending_external_action',
      blockers: [],
      next_action: 'delete_identity',
    });
    expect(repository.lastFailureCode).toBe('DELETE_IDENTITY_FAILED');
    expect(repository.lastFailureCode).not.toContain('provider password');

    const retry = await service.requestDeletion(confirmedRequest());

    expect(retry).toEqual({ status: 'completed', blockers: [] });
    expect(identity.events).toEqual([
      `cognito:disable:${identityId}`,
      `cognito:delete:${identityId}`,
      `cognito:delete:${identityId}`,
    ]);
  });

  it('完了済みの削除要求を再送しても外部操作を再実行しない', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    repository.request.status = 'completed';
    const subscriptions = new FakeSubscriptionCancellationPort();
    const identity = new FakeIdentityDeletionPort();
    const assets = new FakeAssetLifecyclePort();
    const service = new AccountDeletionService(repository, subscriptions, identity, assets);

    const result = await service.requestDeletion(confirmedRequest());

    expect(result).toEqual({ status: 'completed', blockers: [] });
    expect(repository.getFlightCalls).toBe(0);
    expect(subscriptions.cancelled).toEqual([]);
    expect(identity.events).toEqual([]);
    expect(assets.scheduledKeys).toEqual([]);
  });

  it('同時の削除要求では取得できた一件だけが外部操作を開始する', async () => {
    const repository = new InMemoryAccountDeletionRepository();
    repository.flight.activePersonalSubscriptionIds = ['sub_123'];
    const subscriptions = new FakeSubscriptionCancellationPort();
    subscriptions.waitUntilReleased = true;
    const service = new AccountDeletionService(
      repository,
      subscriptions,
      new FakeIdentityDeletionPort(),
      new FakeAssetLifecyclePort(),
    );

    const first = service.requestDeletion(confirmedRequest());
    await subscriptions.waitForFirstCancellation();
    const second = await service.requestDeletion(confirmedRequest());
    subscriptions.release();
    const firstResult = await first;

    expect(second).toEqual({ status: 'in_progress', blockers: [] });
    expect(firstResult).toEqual({ status: 'completed', blockers: [] });
    expect(subscriptions.cancelled).toEqual(['sub_123']);
  });
});

function confirmedRequest(): {
  userId: string;
  identityId: string;
  confirmation: 'DELETE';
  acknowledgeActiveSubscription: boolean;
  acknowledgeConfirmedAssets: boolean;
} {
  return {
    userId,
    identityId,
    confirmation: 'DELETE',
    acknowledgeActiveSubscription: true,
    acknowledgeConfirmedAssets: true,
  };
}

class InMemoryAccountDeletionRepository implements AccountDeletionRepository {
  public flight = {
    uniqueOwnerOrganizations: [] as Array<{ id: string; name: string }>,
    activePersonalSubscriptionIds: [] as string[],
    activeMobileStoreSubscriptionCount: 0,
    confirmedAssetCount: 0,
    personalAssetKeys: [] as string[],
  };
  public request = {
    userId,
    identityId,
    cancelledSubscriptionIds: [] as string[],
    identityDisabled: false,
    identityDeleted: false,
    scheduledAssetKeys: [] as string[],
    dataAnonymized: false,
    status: 'processing' as 'processing' | 'completed',
  };
  public anonymizedUserIds: string[] = [];
  public lastFailureCode: string | null = null;
  public events: string[] = [];
  public getFlightCalls = 0;
  public claimCalls = 0;
  private claimed = false;

  public async getFlight(): Promise<typeof this.flight> {
    this.getFlightCalls += 1;
    return this.flight;
  }

  public async getRequest(): Promise<typeof this.request | null> {
    return this.request;
  }

  public async claimRequest(input: {
    userId: string;
    identityId: string;
    processingToken: string;
  }): Promise<typeof this.request | null> {
    this.claimCalls += 1;
    if (this.claimed) {
      return null;
    }
    this.claimed = true;
    this.request.userId = input.userId;
    this.request.identityId = input.identityId;
    return this.request;
  }

  public async recordBlocked(): Promise<void> {}

  public async markSubscriptionCancelled(_userId: string, subscriptionId: string): Promise<void> {
    this.request.cancelledSubscriptionIds.push(subscriptionId);
  }

  public async markIdentityDisabled(): Promise<void> {
    this.request.identityDisabled = true;
  }

  public async markIdentityDeleted(): Promise<void> {
    this.request.identityDeleted = true;
  }

  public async markAssetKeyScheduled(_userId: string, key: string): Promise<void> {
    this.request.scheduledAssetKeys.push(key);
  }

  public async anonymizePersonalData(deletionUserId: string): Promise<void> {
    this.events.push(`db:${deletionUserId}`);
    this.anonymizedUserIds.push(deletionUserId);
    this.request.dataAnonymized = true;
  }

  public async markCompleted(): Promise<void> {
    this.request.status = 'completed';
    this.claimed = false;
  }

  public async recordExternalFailure(_userId: string, failureCode: string): Promise<void> {
    this.lastFailureCode = failureCode;
    this.claimed = false;
  }
}

class FakeSubscriptionCancellationPort implements AccountSubscriptionCancellationPort {
  public cancelled: string[] = [];
  public waitUntilReleased = false;
  private resolveFirstCancellation: (() => void) | null = null;
  private readonly firstCancellation = new Promise<void>((resolve) => {
    this.resolveFirstCancellation = resolve;
  });
  private resolveRelease: (() => void) | null = null;
  private readonly releaseSignal = new Promise<void>((resolve) => {
    this.resolveRelease = resolve;
  });

  public constructor(private readonly events: string[] = []) {}

  public async cancelSubscription(subscriptionId: string): Promise<void> {
    this.cancelled.push(subscriptionId);
    this.events.push(`stripe:${subscriptionId}`);
    this.resolveFirstCancellation?.();
    if (this.waitUntilReleased) {
      await this.releaseSignal;
    }
  }

  public async waitForFirstCancellation(): Promise<void> {
    await this.firstCancellation;
  }

  public release(): void {
    this.resolveRelease?.();
  }
}

class FakeIdentityDeletionPort implements AccountIdentityDeletionPort {
  public events: string[];
  public failDeleteOnce = false;

  public constructor(events: string[] = []) {
    this.events = events;
  }

  public async disableIdentity(subject: string): Promise<void> {
    this.events.push(`cognito:disable:${subject}`);
  }

  public async deleteIdentity(subject: string): Promise<void> {
    this.events.push(`cognito:delete:${subject}`);
    if (this.failDeleteOnce) {
      this.failDeleteOnce = false;
      throw new Error('provider password must not leak');
    }
  }
}

class FakeAssetLifecyclePort implements AccountAssetLifecyclePort {
  public scheduledKeys: string[] = [];
  public failOnce = false;

  public constructor(private readonly events: string[] = []) {}

  public async scheduleDeletion(key: string): Promise<void> {
    this.scheduledKeys.push(key);
    this.events.push(`s3:${key}`);
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error('asset adapter unavailable');
    }
  }
}
