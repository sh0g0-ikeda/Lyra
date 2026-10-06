import { describe, expect, it } from 'vitest';
import {
  LegacyAccountAssetLifecycle,
  type LegacyAccountAssetLifecycleClient,
  type LegacyAccountAssetLifecyclePort,
  type LegacyAccountAssetTag,
} from '../../../../src/legacy/account/LegacyAccountAssetLifecycle.js';
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
  public assetCheckpoints: Array<{ userId: string; token: string; key: string }> = [];

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
  public async markAssetScheduled(userId: string, token: string, key: string): Promise<boolean> {
    this.assetCheckpointCalls += 1;
    this.assetCheckpoints.push({ userId, token, key });
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
  // Spec 5/8/11: compose the real legacy lifecycle with the service, using only a fake
  // tag client. Expired personal token inventory remains separate from saved-asset consent.
  it('期限切れpersonal一時keyは実lifecycleでexact予約してcheckpointする（物理削除は未証明）', async () => {
    const { repository, providers, client, service, claimed } = composedLifecycle();
    expect((await service.getDeletionPreview(USER_ID)).personalAssetCount).toBe(0);
    const result = await service.requestDeletion({ ...requestInput(), acknowledgePersonalAssets: false });
    expect({ result, gets: client.gets, puts: client.puts, checkpoints: repository.assetCheckpoints,
      failures: repository.failures, scheduled: claimed.scheduledAssetKeys, owner: claimed.processingToken,
    }).toEqual({
      result: { status: 'completed', blockers: [] }, gets: [TEMPORARY_KEY],
      puts: [{ key: TEMPORARY_KEY, tags: [{ Key: 'owner', Value: 'kept' }, { Key: 'lyra-deletion-state', Value: 'pending' }] }],
      checkpoints: [{ userId: USER_ID, token: TOKEN, key: TEMPORARY_KEY }], failures: [],
      scheduled: [TEMPORARY_KEY], owner: TOKEN,
    });
    expect(providers.identities).toEqual(['disable:identity-1', 'delete:identity-1']);
  });

  it.each(['unknown', 'applied'] as const)('一時keyの予約応答喪失後は実tag照合%sに従ってのみ進む', async (outcome) => {
    const { repository, providers, client, service, claimed } = composedLifecycle();
    client.putOutcome = outcome;
    expect(await service.requestDeletion(requestInput())).toEqual({
      status: outcome === 'applied' ? 'completed' : 'in_progress', blockers: [],
    });
    expect(client.gets).toEqual([TEMPORARY_KEY, TEMPORARY_KEY]);
    expect(client.puts).toHaveLength(1);
    expect(repository.assetCheckpointCalls).toBe(outcome === 'applied' ? 1 : 0);
    expect(claimed.scheduledAssetKeys).toEqual(outcome === 'applied' ? [TEMPORARY_KEY] : []);
    expect(providers.identities).toHaveLength(outcome === 'applied' ? 2 : 0);
    expect(repository.failures).toEqual([]);
    expect(claimed.processingToken).toBe(TOKEN);
  });

  it('実lifecycleの読み取り失敗はcheckpointせずownerを保持して後続を止める', async () => {
    const { repository, providers, client, service, claimed } = composedLifecycle();
    client.getError = new Error('tag read unavailable');
    expect(await service.requestDeletion(requestInput())).toEqual({ status: 'in_progress', blockers: [] });
    expect(client.gets).toEqual([TEMPORARY_KEY, TEMPORARY_KEY]);
    expect(client.puts).toEqual([]);
    expect(repository.assetCheckpoints).toEqual([]);
    expect(repository.failures).toEqual([]);
    expect(claimed.processingToken).toBe(TOKEN);
    expect(providers.identities).toEqual([]);
  });

  it.each(['active_upload', 'saved_consent'] as const)('実lifecycleでも%s blockerは外部callを始めない', async (blocker) => {
    const { repository, providers, client, service } = composedLifecycle();
    if (blocker === 'active_upload') repository.flight.activePersonalUploadCount = 1;
    else repository.flight.personalAssetKeys = ['saved/user/page.png'];
    expect(await service.requestDeletion({ ...requestInput(), acknowledgePersonalAssets: false }))
      .toMatchObject({ status: 'blocked' });
    expect(client.gets).toEqual([]);
    expect(client.puts).toEqual([]);
    expect(repository.assetCheckpoints).toEqual([]);
    expect(providers.identities).toEqual([]);
  });
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

const TEMPORARY_KEY = `tmp/${USER_ID}/entities/imports/${TOKEN}.jpeg`;

class ComposedTagClient implements LegacyAccountAssetLifecycleClient {
  public gets: string[] = [];
  public puts: Array<{ key: string; tags: readonly LegacyAccountAssetTag[] }> = [];
  public tags: readonly LegacyAccountAssetTag[] = [{ Key: 'owner', Value: 'kept' }];
  public putOutcome: 'success' | 'applied' | 'unknown' = 'success';
  public getError: Error | null = null;

  public async getObjectTags(input: { key: string }): Promise<readonly LegacyAccountAssetTag[]> {
    this.gets.push(input.key);
    if (this.getError !== null) throw this.getError;
    return this.tags;
  }
  public async putObjectTags(input: { key: string; tags: readonly LegacyAccountAssetTag[] }): Promise<void> {
    this.puts.push({ key: input.key, tags: input.tags });
    if (this.putOutcome !== 'unknown') this.tags = input.tags;
    if (this.putOutcome !== 'success') throw new Error('tag write response lost');
  }
}

function composedLifecycle(): {
  repository: MemoryRepository; providers: RecordingProviders; client: ComposedTagClient;
  service: LegacyAccountDeletionServiceAdapter; claimed: LegacyAccountDeletionRequestRecord;
} {
  const repository = new MemoryRepository();
  repository.flight = { ...emptyFlight(), personalTemporaryUploadKeys: [TEMPORARY_KEY] };
  const claimed = buildRequest(TOKEN);
  repository.claimResult = { kind: 'claimed', request: claimed };
  const providers = new RecordingProviders();
  const client = new ComposedTagClient();
  const assets = new LegacyAccountAssetLifecycle(client, { bucketName: 'images' });
  const service = new LegacyAccountDeletionServiceAdapter(repository, providers, providers, assets);
  return { repository, providers, client, service, claimed };
}
