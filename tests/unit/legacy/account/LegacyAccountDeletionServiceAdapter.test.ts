import { describe, expect, it } from 'vitest';
import type { LegacyAccountAssetLifecyclePort } from '../../../../src/legacy/account/LegacyAccountAssetLifecycle.js';
import {
  LegacyAccountDeletionServiceAdapter,
  type LegacyAccountIdentityDeletionPort,
  type LegacyAccountSubscriptionCancellationPort,
} from '../../../../src/legacy/account/LegacyAccountDeletionServiceAdapter.js';
import type {
  LegacyAccountDeletionClaimInput,
  LegacyAccountDeletionClaimResult,
  LegacyAccountDeletionFlight,
  LegacyAccountDeletionRepositoryPort,
  LegacyAccountDeletionRequestRecord,
} from '../../../../src/legacy/account/LegacyAccountDeletionTypes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';

class MemoryRepository implements LegacyAccountDeletionRepositoryPort {
  public flight = emptyFlight();
  public request: LegacyAccountDeletionRequestRecord | null = null;
  public claimResult: LegacyAccountDeletionClaimResult | null = null;
  public pending: LegacyAccountDeletionRequestRecord[] = [];
  public claimExclusions: string[][] = [];
  public failures: string[] = [];
  public assetCas = true;
  public assetCheckpointError: Error | null = null;
  public assetCheckpointCalls = 0;

  public async getFlight(): Promise<LegacyAccountDeletionFlight> { return this.flight; }
  public async getRequest(): Promise<LegacyAccountDeletionRequestRecord | null> { return this.request; }
  public async recordBlocked(): Promise<boolean> { return true; }
  public async markClaimBlocked(): Promise<boolean> { return true; }
  public async claimRequest(input: LegacyAccountDeletionClaimInput): Promise<LegacyAccountDeletionClaimResult> {
    return this.claimResult ?? { kind: 'claimed', request: buildRequest(input.processingToken) };
  }
  public async claimNextPending(
    _processingToken: string,
    excludedUserIds: readonly string[] = [],
  ): Promise<LegacyAccountDeletionRequestRecord | null> {
    this.claimExclusions.push([...excludedUserIds]);
    return this.pending.shift() ?? null;
  }
  public async markSubscriptionCancelled(): Promise<boolean> { return true; }
  public async markAssetScheduled(): Promise<boolean> {
    this.assetCheckpointCalls += 1;
    if (this.assetCheckpointError !== null) throw this.assetCheckpointError;
    return this.assetCas;
  }
  public async anonymizePersonalData(): Promise<boolean> { return true; }
  public async markIdentityDisabled(): Promise<boolean> { return true; }
  public async markIdentityDeleted(): Promise<boolean> { return true; }
  public async markCompleted(): Promise<boolean> { return true; }
  public async recordFailure(_userId: string, _token: string, code: string): Promise<boolean> {
    this.failures.push(code);
    return true;
  }
}

class RecordingProviders implements LegacyAccountSubscriptionCancellationPort,
LegacyAccountIdentityDeletionPort, LegacyAccountAssetLifecyclePort {
  public cancelled: string[] = [];
  public scheduled: string[] = [];
  public identities: string[] = [];
  public scheduleError: Error | null = null;
  public scheduleNeverSettles = false;
  public scheduleDelayMs = 0;
  public assetReconciliation: 'applied' | 'unknown' = 'unknown';
  public scheduleSignals: AbortSignal[] = [];
  public reconciliationCalls = 0;
  public async cancelPersonalSubscription(id: string): Promise<void> { this.cancelled.push(id); }
  public async reconcilePersonalSubscriptionCancellation(): Promise<'applied' | 'unknown'> {
    return 'unknown';
  }
  public async scheduleDeletion(
    key: string,
    context?: { signal: AbortSignal; deadlineAt: number },
  ): Promise<void> {
    this.scheduled.push(key);
    if (context !== undefined) this.scheduleSignals.push(context.signal);
    if (this.scheduleNeverSettles) await new Promise<void>(() => undefined);
    if (this.scheduleDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.scheduleDelayMs));
    }
    if (this.scheduleError !== null) throw this.scheduleError;
  }
  public async reconcileDeletionSchedule(): Promise<'applied' | 'unknown'> {
    this.reconciliationCalls += 1;
    return this.assetReconciliation;
  }
  public async disableIdentity(id: string): Promise<void> { this.identities.push(`disable:${id}`); }
  public async reconcileIdentityDisabled(): Promise<'applied' | 'unknown'> { return 'unknown'; }
  public async deleteIdentity(id: string): Promise<void> { this.identities.push(`delete:${id}`); }
  public async reconcileIdentityDeleted(): Promise<'applied' | 'unknown'> { return 'unknown'; }
}

describe('LegacyAccountDeletionServiceAdapter', () => {
  it('Spec 5/8/11 有効な個人uploadがある場合は既存job blockerで外部処理を止める', async () => {
    const repository = new MemoryRepository();
    repository.flight = { ...emptyFlight(), activePersonalUploadCount: 2 };
    const providers = new RecordingProviders();
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);
    expect((await service.getDeletionPreview(USER_ID)).activePersonalJobCount).toBe(2);
    expect(await service.requestDeletion(requestInput())).toEqual({
      status: 'blocked', blockers: [{ code: 'ACTIVE_PERSONAL_JOB', job_count: 2 }],
    });
    expect(providers.scheduled).toEqual([]);
    expect(providers.identities).toEqual([]);
    repository.pending.push(buildRequest(TOKEN));
    expect(await service.recoverPendingRequests(1)).toEqual({ attemptedCount: 1, completedCount: 0 });
    expect(providers.identities).toEqual([]);
  });

  it('期限切れ一時keyは保存asset同意に含めず重複なく削除予約する', async () => {
    const repository = new MemoryRepository();
    repository.flight = { ...emptyFlight(), personalTemporaryUploadKeys: ['temporary/failed-signing.png', 'temporary/failed-signing.png'] };
    const providers = new RecordingProviders();
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);
    expect((await service.getDeletionPreview(USER_ID)).personalAssetCount).toBe(0);
    expect(await service.requestDeletion({ ...requestInput(), acknowledgePersonalAssets: false }))
      .toEqual({ status: 'completed', blockers: [] });
    expect(providers.scheduled).toEqual(['temporary/failed-signing.png']);
    expect(repository.assetCheckpointCalls).toBe(1);
  });

  it('active jobやsole ownerは外部処理とclaimの前にblockedになる', async () => {
    const repository = new MemoryRepository();
    repository.flight = { ...emptyFlight(), activePersonalGenerationJobCount: 1 };
    const providers = new RecordingProviders();
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);

    const result = await service.requestDeletion(requestInput());

    expect(result).toMatchObject({ status: 'blocked' });
    expect(providers.cancelled).toEqual([]);
    expect(providers.scheduled).toEqual([]);
  });

  it('旧scheduled checkpointは物理削除せず残りの処理を再開する', async () => {
    const repository = new MemoryRepository();
    repository.flight = { ...emptyFlight(), personalAssetKeys: ['saved/user/page.png'] };
    repository.claimResult = { kind: 'claimed', request: {
      ...buildRequest(TOKEN), scheduledAssetKeys: ['saved/user/page.png'],
    } };
    const providers = new RecordingProviders();
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);

    expect(await service.requestDeletion(requestInput())).toEqual({ status: 'completed', blockers: [] });
    expect(providers.scheduled).toEqual([]);
    expect(providers.identities).toEqual(['disable:identity-1', 'delete:identity-1']);
  });

  it('provider結果不明ではcheckpointを進めずprocessing ownerを保持する', async () => {
    const repository = new MemoryRepository();
    repository.flight = { ...emptyFlight(), personalAssetKeys: ['saved/user/page.png'] };
    const providers = new RecordingProviders();
    providers.scheduleError = new Error('response lost');
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);

    expect(await service.requestDeletion(requestInput())).toEqual({ status: 'in_progress', blockers: [] });
    expect(repository.failures).toEqual([]);
    expect(providers.reconciliationCalls).toBe(1);
  });

  it('never-settling providerを期限で中断し照合不能ならprocessing ownerを解放しない', async () => {
    const repository = new MemoryRepository();
    repository.flight = { ...emptyFlight(), personalAssetKeys: ['saved/user/page.png'] };
    const providers = new RecordingProviders();
    providers.scheduleNeverSettles = true;
    const service = new LegacyAccountDeletionServiceAdapter(
      repository, providers, providers, providers,
      { externalCallTimeoutMs: 20 },
    );

    expect(await service.requestDeletion(requestInput())).toEqual({ status: 'in_progress', blockers: [] });
    expect(providers.scheduleSignals[0]?.aborted).toBe(true);
    expect(providers.reconciliationCalls).toBe(1);
    expect(repository.assetCheckpointCalls).toBe(0);
    expect(repository.failures).toEqual([]);
  }, 500);

  it('timeout後にproviderが遅延成功してもunknown checkpointを作らずownerを保持する', async () => {
    const repository = new MemoryRepository();
    repository.flight = { ...emptyFlight(), personalAssetKeys: ['saved/user/page.png'] };
    const providers = new RecordingProviders();
    providers.scheduleDelayMs = 60;
    const service = new LegacyAccountDeletionServiceAdapter(
      repository, providers, providers, providers,
      { externalCallTimeoutMs: 10 },
    );

    expect(await service.requestDeletion(requestInput())).toEqual({ status: 'in_progress', blockers: [] });
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    expect(repository.assetCheckpointCalls).toBe(0);
    expect(repository.failures).toEqual([]);
    expect(providers.reconciliationCalls).toBe(1);
  });

  it('response loss後の照合で適用済みならcheckpointして処理を継続する', async () => {
    const repository = new MemoryRepository();
    repository.flight = { ...emptyFlight(), personalAssetKeys: ['saved/user/page.png'] };
    const providers = new RecordingProviders();
    providers.scheduleError = new Error('response lost');
    providers.assetReconciliation = 'applied';
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);

    expect(await service.requestDeletion(requestInput())).toEqual({ status: 'completed', blockers: [] });
    expect(providers.reconciliationCalls).toBe(1);
    expect(repository.assetCheckpointCalls).toBe(1);
    expect(repository.failures).toEqual([]);
  });

  it('provider成功後のcheckpoint応答不明ではpendingへ戻さずownerを保持する', async () => {
    const repository = new MemoryRepository();
    repository.flight = { ...emptyFlight(), personalAssetKeys: ['saved/user/page.png'] };
    repository.assetCheckpointError = new Error('database response lost');
    const providers = new RecordingProviders();
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);

    expect(await service.requestDeletion(requestInput())).toEqual({ status: 'in_progress', blockers: [] });
    expect(repository.assetCheckpointCalls).toBe(1);
    expect(repository.failures).toEqual([]);
    expect(providers.identities).toEqual([]);
  });

  it('provider成功後にtoken CASを失った場合は後続処理を開始しない', async () => {
    const repository = new MemoryRepository();
    repository.flight = { ...emptyFlight(), personalAssetKeys: ['saved/user/page.png'] };
    repository.assetCas = false;
    const providers = new RecordingProviders();
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);

    expect(await service.requestDeletion(requestInput())).toEqual({ status: 'in_progress', blockers: [] });
    expect(providers.scheduled).toEqual(['saved/user/page.png']);
    expect(providers.identities).toEqual([]);
  });

  it('pendingだけをclaimして既存checkpointからrecoveryを継続する', async () => {
    const repository = new MemoryRepository();
    repository.pending.push({ ...buildRequest(TOKEN), status: 'processing', dataAnonymized: true });
    const providers = new RecordingProviders();
    const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, providers);

    expect(await service.recoverPendingRequests(10)).toEqual({ attemptedCount: 1, completedCount: 1 });
    expect(providers.identities).toEqual(['disable:identity-1', 'delete:identity-1']);
    expect(repository.claimExclusions).toEqual([[], [USER_ID]]);
  });

  it('外部step上限後は追加provider処理を始めずpendingへ戻す', async () => {
    const repository = new MemoryRepository();
    repository.flight = {
      ...emptyFlight(), personalAssetKeys: ['saved/user/one.png', 'saved/user/two.png'],
    };
    const providers = new RecordingProviders();
    const service = new LegacyAccountDeletionServiceAdapter(
      repository, providers, providers, providers,
      { maxExternalStepsPerAttempt: 1 },
    );

    expect(await service.requestDeletion(requestInput())).toMatchObject({
      status: 'pending_external_action', next_action: 'delete_personal_assets',
    });
    expect(providers.scheduled).toEqual(['saved/user/one.png']);
    expect(repository.failures).toEqual(['ATTEMPT_BUDGET_EXHAUSTED']);
  });
});

function emptyFlight(): LegacyAccountDeletionFlight {
  return {
    uniqueOwnerOrganizations: [], activePersonalStripeSubscriptionIds: [],
    activeStoreSubscriptions: [], personalAssetKeys: [],
    personalTemporaryUploadKeys: [], activePersonalUploadCount: 0,
    activePersonalGenerationJobCount: 0, activePersonalExportJobCount: 0,
  };
}

function buildRequest(processingToken: string): LegacyAccountDeletionRequestRecord {
  return {
    userId: USER_ID, identityId: 'identity-1', status: 'processing', processingToken,
    cancelledSubscriptionIds: [], scheduledAssetKeys: [], dataAnonymized: false,
    identityDisabled: false, identityDeleted: false,
  };
}

function requestInput() {
  return {
    userId: USER_ID, identityId: 'identity-1', confirmation: 'DELETE' as const,
    acknowledgePersonalSubscriptions: true, acknowledgeStoreBilling: true,
    acknowledgePersonalAssets: true,
  };
}
