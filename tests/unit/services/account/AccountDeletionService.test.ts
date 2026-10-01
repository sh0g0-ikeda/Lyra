import { describe, expect, it, vi } from 'vitest';
import type {
  ClaimAccountDeletionInput,
  AccountDeletionClaimResult,
  AccountDeletionFlight,
  AccountDeletionRepository,
  AccountDeletionRequestRecord,
  AccountDeletionFinalizeResult,
} from '../../../../src/repositories/AccountDeletionRepository.js';
import {
  AccountDeletionService,
  type AccountAssetDeletionPort,
  type AccountIdentityDeletionPort,
  type AccountSubscriptionCancellationPort,
} from '../../../../src/services/account/AccountDeletionService.js';

class FakeRepository implements AccountDeletionRepository {
  public flight = emptyFlight();
  public request: AccountDeletionRequestRecord | null = null;
  public claimResult: AccountDeletionClaimResult | null = null;
  public finalizeResult: AccountDeletionFinalizeResult = { kind: 'completed' };
  public blockedCodes: string[] = [];
  public cancelled: string[] = [];
  public deletedAssets: string[] = [];
  public completed = false;
  public failures: string[] = [];
  public continuationCount = 0;
  public recoverableRequests: AccountDeletionRequestRecord[] = [];
  public recoveryClaimTokens: string[] = [];
  public claimInput: ClaimAccountDeletionInput | null = null;

  public async getFlight(): Promise<AccountDeletionFlight> {
    return this.flight;
  }

  public async getRequest(): Promise<AccountDeletionRequestRecord | null> {
    return this.request;
  }

  public async recordBlocked(_userId: string, blockerCodes: string[]): Promise<void> {
    this.blockedCodes = blockerCodes;
  }

  public async claimRequest(
    input: ClaimAccountDeletionInput,
  ): Promise<AccountDeletionClaimResult> {
    this.claimInput = input;
    return this.claimResult ?? { kind: 'claimed', request: buildRequest() };
  }

  public async claimNextRecoverable(
    processingToken: string,
  ): Promise<AccountDeletionRequestRecord | null> {
    this.recoveryClaimTokens.push(processingToken);
    const request = this.recoverableRequests.shift() ?? null;
    return request === null ? null : { ...request, processingToken };
  }

  public async markSubscriptionCancelled(
    _userId: string,
    _processingToken: string,
    subscriptionId: string,
  ): Promise<void> {
    this.cancelled.push(subscriptionId);
  }

  public async markAssetDeleted(
    _userId: string,
    _processingToken: string,
    key: string,
  ): Promise<void> {
    this.deletedAssets.push(key);
  }

  public async finalizePersonalData(): Promise<AccountDeletionFinalizeResult> {
    return this.finalizeResult;
  }

  public async markIdentityDisabled(): Promise<void> {}
  public async markIdentityDeleted(): Promise<void> {}

  public async markCompleted(): Promise<void> {
    this.completed = true;
  }

  public async recordFailure(
    _userId: string,
    _processingToken: string,
    failureCode: string,
  ): Promise<void> {
    this.failures.push(failureCode);
  }

  public async releaseForContinuation(
    _userId: string,
    _processingToken: string,
  ): Promise<void> {
    this.continuationCount += 1;
  }
}

class FakeSubscriptions implements AccountSubscriptionCancellationPort {
  public calls: string[] = [];
  public async cancelPersonalSubscription(subscriptionId: string): Promise<void> {
    this.calls.push(subscriptionId);
  }
}

class FakeIdentity implements AccountIdentityDeletionPort {
  public calls: string[] = [];
  public async disableIdentity(identityId: string): Promise<void> {
    this.calls.push(`disable:${identityId}`);
  }
  public async deleteIdentity(identityId: string): Promise<void> {
    this.calls.push(`delete:${identityId}`);
  }
}

class FakeAssets implements AccountAssetDeletionPort {
  public calls: string[] = [];
  public async deleteExactObject(key: string): Promise<void> {
    this.calls.push(key);
  }
}

describe('AccountDeletionService', () => {
  it('復旧claimに未確定copyがあれば既存削除checkpointがあっても外部操作を再開しない', async () => {
    const repository = new FakeRepository();
    repository.flight = { ...emptyFlight(), activePersonalGenerationJobCount: 1,
      activePersonalStripeSubscriptionIds: ['sub-1'], personalAssetKeys: ['saved/late-copy.png'] };
    repository.recoverableRequests = [{ ...buildRequest(), deletedAssetKeys: ['saved/late-copy.png'] }];
    const subscriptions = new FakeSubscriptions();
    const identity = new FakeIdentity();
    const assets = new FakeAssets();
    const service = new AccountDeletionService(repository, subscriptions, identity, assets,
      'account-deletion-local-test-secret-only');
    expect(await service.recoverPendingRequests(1)).toEqual({ attemptedCount: 1, completedCount: 0 });
    expect(subscriptions.calls).toEqual([]);
    expect(identity.calls).toEqual([]);
    expect(assets.calls).toEqual([]);
    expect(repository.completed).toBe(false);
    expect(repository.failures).toEqual(['EXTERNAL_REVALIDATION_BLOCKED']);
  });

  it('v2 assets require acknowledgement without becoming legacy active jobs', async () => {
    const repository = new FakeRepository();
    repository.flight.personalStateReferenceCount = 2;
    const service = buildService(repository);
    expect(await service.getDeletionPreview('user-1')).toMatchObject({ personalAssetCount: 2, activePersonalJobCount: 0 });
    expect(await service.requestDeletion({ ...buildInput(), acknowledgePersonalAssets: false }))
      .toEqual({ status: 'blocked', blockers: [{ code: 'PERSONAL_ASSETS', asset_count: 2 }] });
    expect(repository.claimInput).toBeNull();
  });

  it.each(['missing', 'unresolved', 'error', 'false-success'] as const)('v2 %s recovery cannot complete or run legacy actions', async (mode) => {
    const repository = new FakeRepository();
    repository.flight.personalStateReferenceCount = 1;
    repository.flight.activePersonalStripeSubscriptionIds = ['sub-1'];
    repository.flight.personalAssetKeys = ['legacy-key'];
    repository.recoverableRequests = [buildRequest({ deletedAssetKeys: ['state-reference-v2/old-checkpoint'], dataAnonymized: true })];
    const subscriptions = new FakeSubscriptions(); const identity = new FakeIdentity(); const assets = new FakeAssets();
    const fencePersonalReferences = vi.fn(async () => {
      if (mode === 'error') throw new Error('private provider detail');
      return mode === 'false-success';
    });
    const service = new AccountDeletionService(repository, subscriptions, identity, assets, 'account-deletion-local-test-secret-only', {
      stateReferenceFencing: mode === 'missing' ? undefined : { fencePersonalReferences },
    });
    expect(await service.recoverPendingRequests(1)).toEqual({ attemptedCount: 1, completedCount: 0 });
    expect(subscriptions.calls).toEqual([]); expect(identity.calls).toEqual([]); expect(assets.calls).toEqual([]);
    expect(repository.completed).toBe(false);
    expect(repository.failures).toEqual(['FENCE_PERSONAL_STATE_REFERENCES_FAILED']);
  });

  it('claimed v2 fencing precedes all legacy actions and shares the request budget without double counting', async () => {
    const repository = new FakeRepository(); repository.flight.personalStateReferenceCount = 1;
    repository.flight.activePersonalStripeSubscriptionIds = ['sub-1']; repository.flight.personalAssetKeys = ['legacy-key'];
    const order: string[] = [];
    const service = new AccountDeletionService(repository,
      { cancelPersonalSubscription: async () => { order.push('subscription'); } },
      { disableIdentity: async () => { order.push('disable'); }, deleteIdentity: async () => { order.push('identity'); } },
      { deleteExactObject: async () => { order.push('asset'); } }, 'account-deletion-local-test-secret-only', {
        maxExternalStepsPerAttempt: 6,
        stateReferenceFencing: { fencePersonalReferences: async (userId, token, budget) => {
          expect(userId).toBe('user-1'); expect(token).toBe(buildRequest().processingToken);
          expect(repository.claimInput).not.toBeNull();
          budget.beforeRequest(); order.push('v2-read'); budget.beforeRequest(); order.push('v2-marker');
          repository.flight.personalStateReferenceCount = 0;
          return true;
        } },
      });
    expect(await service.requestDeletion(buildInput())).toEqual({ status: 'completed', blockers: [] });
    expect(order).toEqual(['v2-read', 'v2-marker', 'subscription', 'asset', 'disable', 'identity']);
    expect(repository.continuationCount).toBe(0);
  });

  it('each nested request consumes the shared default 25-step budget and resumes without failure backoff', async () => {
    const repository = new FakeRepository(); repository.flight.personalStateReferenceCount = 1;
    const identity = new FakeIdentity(); let sent = 0;
    const service = new AccountDeletionService(repository, new FakeSubscriptions(), identity, new FakeAssets(), 'account-deletion-local-test-secret-only', {
      stateReferenceFencing: { fencePersonalReferences: async (_user, _token, budget) => {
        for (let index = 0; index < 30; index++) { budget.beforeRequest(); sent++; }
        return true;
      } },
    });
    expect(await service.requestDeletion(buildInput())).toMatchObject({ status: 'pending_external_action', next_action: 'delete_personal_assets' });
    expect(sent).toBe(25); expect(repository.continuationCount).toBe(1); expect(repository.failures).toEqual([]);
    expect(identity.calls).toEqual([]); expect(repository.completed).toBe(false);
  });

  it('an exhausted nested budget remains a continuation when the adapter sanitizes the thrown error', async () => {
    const repository = new FakeRepository(); repository.flight.personalStateReferenceCount = 1;
    let now = 0;
    const service = new AccountDeletionService(repository, new FakeSubscriptions(), new FakeIdentity(), new FakeAssets(), 'account-deletion-local-test-secret-only', {
      now: () => now,
      stateReferenceFencing: { fencePersonalReferences: async (_user, _token, budget) => {
        expect(budget.remainingTimeMs()).toBe(15_000); budget.beforeRequest(); now = 15_000;
        throw new Error('sanitized adapter timeout');
      } },
    });
    expect(await service.requestDeletion(buildInput())).toMatchObject({ status: 'pending_external_action' });
    expect(repository.continuationCount).toBe(1); expect(repository.failures).toEqual([]);
  });

  it.each([false, true])('reserved namespace is never legacy-deleted even with an old checkpoint (%s)', async (checkpoint) => {
    const repository = new FakeRepository(); const key = 'state-reference-v2/malformed';
    repository.flight.personalAssetKeys = [key];
    repository.claimResult = { kind: 'claimed', request: buildRequest({ deletedAssetKeys: checkpoint ? [key] : [] }) };
    const assets = new FakeAssets(); const identity = new FakeIdentity();
    const service = new AccountDeletionService(repository, new FakeSubscriptions(), identity, assets, 'account-deletion-local-test-secret-only');
    expect(await service.requestDeletion(buildInput())).toMatchObject({ status: 'pending_external_action' });
    expect(assets.calls).toEqual([]); expect(identity.calls).toEqual([]); expect(repository.completed).toBe(false);
  });

  it('唯一ownerとactive personal jobはacknowledgeできないblockerになる', async () => {
    const repository = new FakeRepository();
    repository.flight = {
      ...emptyFlight(),
      uniqueOwnerOrganizations: [{ id: 'org-1', name: 'Studio' }],
      activePersonalGenerationJobCount: 1,
    };
    const service = buildService(repository);

    const result = await service.requestDeletion(buildInput());

    expect(result).toEqual({
      status: 'blocked',
      blockers: [
        {
          code: 'UNIQUE_ORGANIZATION_OWNER',
          organizations: [{ id: 'org-1', name: 'Studio' }],
        },
        { code: 'ACTIVE_PERSONAL_JOB', job_count: 1 },
      ],
    });
    expect(repository.blockedCodes).toEqual([
      'UNIQUE_ORGANIZATION_OWNER',
      'ACTIVE_PERSONAL_JOB',
    ]);
  });

  it('購読・store課金・assetは該当acknowledgementがない場合だけblockする', async () => {
    const repository = new FakeRepository();
    repository.flight = {
      ...emptyFlight(),
      activePersonalStripeSubscriptionIds: ['sub-1'],
      activeStoreSubscriptions: [
        {
          store: 'apple',
          expiresAt: new Date('2026-08-31T00:00:00.000Z'),
          autoRenewEnabled: true,
        },
      ],
      personalAssetKeys: ['users/u/pages/p.png'],
    };
    const service = buildService(repository);

    const result = await service.requestDeletion({
      ...buildInput(),
      acknowledgePersonalSubscriptions: false,
      acknowledgeStoreBilling: false,
      acknowledgePersonalAssets: false,
    });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.blockers.map((blocker) => blocker.code)).toEqual([
        'ACTIVE_PERSONAL_SUBSCRIPTION',
        'ACTIVE_STORE_SUBSCRIPTION',
        'PERSONAL_ASSETS',
      ]);
    }
  });

  it('claim直前に増えた未確認の購読・assetもtransaction内の再検査でblockする', async () => {
    const repository = new FakeRepository();
    repository.claimResult = {
      kind: 'blocked',
      flight: {
        ...emptyFlight(),
        activePersonalStripeSubscriptionIds: ['sub-raced'],
        activeStoreSubscriptions: [
          {
            store: 'google',
            expiresAt: null,
            autoRenewEnabled: null,
          },
        ],
        personalAssetKeys: ['saved/user-1/pages/raced.webp'],
      },
    };
    const service = buildService(repository);

    const result = await service.requestDeletion({
      ...buildInput(),
      acknowledgePersonalSubscriptions: false,
      acknowledgeStoreBilling: false,
      acknowledgePersonalAssets: false,
    });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.blockers.map((blocker) => blocker.code)).toEqual([
        'ACTIVE_PERSONAL_SUBSCRIPTION',
        'ACTIVE_STORE_SUBSCRIPTION',
        'PERSONAL_ASSETS',
      ]);
    }
    expect(repository.claimInput).toMatchObject({
      acknowledgePersonalSubscriptions: false,
      acknowledgeStoreBilling: false,
      acknowledgePersonalAssets: false,
    });
  });

  it('checkpoint済みstepを飛ばして未完了stepだけ順に実行する', async () => {
    const repository = new FakeRepository();
    repository.flight = {
      ...emptyFlight(),
      activePersonalStripeSubscriptionIds: ['sub-done', 'sub-new'],
      personalAssetKeys: ['asset-done', 'asset-new'],
    };
    repository.claimResult = {
      kind: 'claimed',
      request: buildRequest({
        cancelledSubscriptionIds: ['sub-done'],
        deletedAssetKeys: ['asset-done'],
      }),
    };
    const subscriptions = new FakeSubscriptions();
    const identity = new FakeIdentity();
    const assets = new FakeAssets();
    const service = new AccountDeletionService(
      repository,
      subscriptions,
      identity,
      assets,
      'account-deletion-secret-with-32-bytes',
    );

    const result = await service.requestDeletion(buildInput());

    expect(result).toEqual({ status: 'completed', blockers: [] });
    expect(subscriptions.calls).toEqual(['sub-new']);
    expect(assets.calls).toEqual(['asset-new']);
    expect(identity.calls).toEqual([
      'disable:cognito-sub-1',
      'delete:cognito-sub-1',
    ]);
    expect(repository.completed).toBe(true);
  });

  it('provider失敗をsanitized checkpointにして202相当のpendingを返す', async () => {
    const repository = new FakeRepository();
    repository.flight = {
      ...emptyFlight(),
      personalAssetKeys: ['asset-1'],
    };
    const assets = new FakeAssets();
    assets.deleteExactObject = async () => {
      throw new Error('secret provider response');
    };
    const service = new AccountDeletionService(
      repository,
      new FakeSubscriptions(),
      new FakeIdentity(),
      assets,
      'account-deletion-secret-with-32-bytes',
    );

    const result = await service.requestDeletion(buildInput());

    expect(result).toEqual({
      status: 'pending_external_action',
      blockers: [],
      next_action: 'delete_personal_assets',
    });
    expect(repository.failures).toEqual(['DELETE_PERSONAL_ASSET_FAILED']);
  });

  it('a legacy provider failure at the final allowed step still uses its sanitized failure checkpoint', async () => {
    const repository = new FakeRepository(); repository.flight.personalAssetKeys = ['legacy-asset'];
    const service = new AccountDeletionService(repository, new FakeSubscriptions(), new FakeIdentity(),
      { deleteExactObject: async () => { throw new Error('private provider detail'); } },
      'account-deletion-local-test-secret-only', { maxExternalStepsPerAttempt: 1 });
    expect(await service.requestDeletion(buildInput())).toMatchObject({ status: 'pending_external_action' });
    expect(repository.failures).toEqual(['DELETE_PERSONAL_ASSET_FAILED']); expect(repository.continuationCount).toBe(0);
  });

  it('1回の処理上限に達した場合はcheckpointを保持してworker継続へ渡す', async () => {
    const repository = new FakeRepository();
    repository.flight = {
      ...emptyFlight(),
      personalAssetKeys: ['asset-1', 'asset-2'],
    };
    const assets = new FakeAssets();
    const identity = new FakeIdentity();
    const service = new AccountDeletionService(
      repository,
      new FakeSubscriptions(),
      identity,
      assets,
      'account-deletion-secret-with-32-bytes',
      {
        maxExternalStepsPerAttempt: 1,
        attemptTimeBudgetMs: 60_000,
      },
    );

    const result = await service.requestDeletion(buildInput());

    expect(result).toEqual({
      status: 'pending_external_action',
      blockers: [],
      next_action: 'delete_personal_assets',
    });
    expect(assets.calls).toEqual(['asset-1']);
    expect(repository.deletedAssets).toEqual(['asset-1']);
    expect(repository.continuationCount).toBe(1);
    expect(identity.calls).toEqual([]);
  });

  it('処理時間budgetを超えた場合も次の外部処理前にworker継続へ渡す', async () => {
    const repository = new FakeRepository();
    repository.flight = {
      ...emptyFlight(),
      personalAssetKeys: ['asset-1', 'asset-2'],
    };
    let now = 0;
    const assets = new FakeAssets();
    assets.deleteExactObject = async (key: string) => {
      assets.calls.push(key);
      now = 2_000;
    };
    const service = new AccountDeletionService(
      repository,
      new FakeSubscriptions(),
      new FakeIdentity(),
      assets,
      'account-deletion-secret-with-32-bytes',
      {
        maxExternalStepsPerAttempt: 100,
        attemptTimeBudgetMs: 1_000,
        now: () => now,
      },
    );

    const result = await service.requestDeletion(buildInput());

    expect(result).toMatchObject({
      status: 'pending_external_action',
      next_action: 'delete_personal_assets',
    });
    expect(assets.calls).toEqual(['asset-1']);
    expect(repository.continuationCount).toBe(1);
  });

  it('recoveryはbounded batchでpending requestをcheckpointから再開する', async () => {
    const repository = new FakeRepository();
    repository.recoverableRequests = [buildRequest(), buildRequest()];
    const service = buildService(repository);

    const result = await service.recoverPendingRequests(1);

    expect(result).toEqual({ attemptedCount: 1, completedCount: 1 });
    expect(repository.recoverableRequests).toHaveLength(1);
    expect(repository.recoveryClaimTokens[0]).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
  });
});

function buildService(repository: FakeRepository): AccountDeletionService {
  return new AccountDeletionService(
    repository,
    new FakeSubscriptions(),
    new FakeIdentity(),
    new FakeAssets(),
    'account-deletion-secret-with-32-bytes',
  );
}

function buildInput() {
  return {
    userId: 'user-1',
    identityId: 'cognito-sub-1',
    confirmation: 'DELETE' as const,
    acknowledgePersonalSubscriptions: true,
    acknowledgeStoreBilling: true,
    acknowledgePersonalAssets: true,
  };
}

function emptyFlight(): AccountDeletionFlight {
  return {
    uniqueOwnerOrganizations: [],
    activePersonalStripeSubscriptionIds: [],
    activeStoreSubscriptions: [],
    personalAssetKeys: [],
    activePersonalGenerationJobCount: 0,
    activePersonalExportJobCount: 0,
  };
}

function buildRequest(
  overrides: Partial<AccountDeletionRequestRecord> = {},
): AccountDeletionRequestRecord {
  return {
    userId: 'user-1',
    identityId: 'cognito-sub-1',
    status: 'processing',
    processingToken: '00000000-0000-4000-8000-000000000001',
    cancelledSubscriptionIds: [],
    deletedAssetKeys: [],
    dataAnonymized: false,
    identityDisabled: false,
    identityDeleted: false,
    ...overrides,
  };
}
