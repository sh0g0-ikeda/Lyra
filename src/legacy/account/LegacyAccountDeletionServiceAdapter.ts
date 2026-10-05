import { randomUUID } from 'node:crypto';
import type {
  AccountDeletionBlocker,
  AccountDeletionNextAction,
  AccountDeletionPreview,
  AccountDeletionRequestInput,
  AccountDeletionResult,
  AccountDeletionServicePort,
} from '../../services/account/AccountDeletionService.js';
import type { LegacyAccountAssetLifecyclePort } from './LegacyAccountAssetLifecycle.js';
import type {
  LegacyAccountDeletionExternalCallContext,
  LegacyAccountDeletionExternalEffectState,
  LegacyAccountDeletionFlight,
  LegacyAccountDeletionRepositoryPort,
  LegacyAccountDeletionRequestRecord,
} from './LegacyAccountDeletionTypes.js';

export interface LegacyAccountSubscriptionCancellationPort {
  cancelPersonalSubscription(
    subscriptionId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<void>;
  reconcilePersonalSubscriptionCancellation(
    subscriptionId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<LegacyAccountDeletionExternalEffectState>;
}

export interface LegacyAccountIdentityDeletionPort {
  disableIdentity(identityId: string, context: LegacyAccountDeletionExternalCallContext): Promise<void>;
  reconcileIdentityDisabled(
    identityId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<LegacyAccountDeletionExternalEffectState>;
  deleteIdentity(identityId: string, context: LegacyAccountDeletionExternalCallContext): Promise<void>;
  reconcileIdentityDeleted(
    identityId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<LegacyAccountDeletionExternalEffectState>;
}

export interface LegacyAccountDeletionServiceOptions {
  maxExternalStepsPerAttempt?: number;
  attemptTimeBudgetMs?: number;
  externalCallTimeoutMs?: number;
  now?: () => number;
}

/**
 * Current route facade over the old-027 workflow. S3 work only schedules the
 * old lifecycle tag; the persisted scheduled keys are never reported as proof
 * that an object was physically deleted.
 */
export class LegacyAccountDeletionServiceAdapter implements AccountDeletionServicePort {
  private readonly maxExternalStepsPerAttempt: number;
  private readonly attemptTimeBudgetMs: number;
  private readonly externalCallTimeoutMs: number;
  private readonly now: () => number;

  public constructor(
    private readonly repository: LegacyAccountDeletionRepositoryPort,
    private readonly subscriptions: LegacyAccountSubscriptionCancellationPort,
    private readonly identity: LegacyAccountIdentityDeletionPort,
    private readonly assets: LegacyAccountAssetLifecyclePort,
    options: LegacyAccountDeletionServiceOptions = {},
  ) {
    this.maxExternalStepsPerAttempt = options.maxExternalStepsPerAttempt ?? 25;
    this.attemptTimeBudgetMs = options.attemptTimeBudgetMs ?? 15_000;
    this.externalCallTimeoutMs = options.externalCallTimeoutMs ?? 5_000;
    this.now = options.now ?? Date.now;
    if (
      !Number.isSafeInteger(this.maxExternalStepsPerAttempt)
      || this.maxExternalStepsPerAttempt < 1
      || this.maxExternalStepsPerAttempt > 100
      || !Number.isSafeInteger(this.attemptTimeBudgetMs)
      || this.attemptTimeBudgetMs < 1_000
      || this.attemptTimeBudgetMs > 60_000
      || !Number.isSafeInteger(this.externalCallTimeoutMs)
      || this.externalCallTimeoutMs < 5
      || this.externalCallTimeoutMs > 60_000
    ) {
      throw new Error('Legacy account deletion attempt budget is invalid');
    }
  }

  public async getDeletionPreview(userId: string): Promise<AccountDeletionPreview> {
    const flight = await this.repository.getFlight(userId);
    return {
      personalData: {
        account: 'anonymized', personalWorks: 'deleted',
        organizationMemberships: 'removed', billingRecords: 'retained_for_legal_and_security',
      },
      uniqueOwnerOrganizations: flight.uniqueOwnerOrganizations.slice(0, 25),
      activePersonalStripeSubscriptionCount: flight.activePersonalStripeSubscriptionIds.length,
      activeStoreSubscriptions: flight.activeStoreSubscriptions.map((subscription) => ({
        ...subscription,
        manageUrl: subscription.store === 'apple'
          ? 'https://apps.apple.com/account/subscriptions'
          : 'https://play.google.com/store/account/subscriptions',
      })),
      personalAssetCount: flight.personalAssetKeys.length,
      activePersonalJobCount:
        flight.activePersonalGenerationJobCount + flight.activePersonalExportJobCount + flight.activePersonalUploadCount,
    };
  }

  public async requestDeletion(input: AccountDeletionRequestInput): Promise<AccountDeletionResult> {
    const existing = await this.repository.getRequest(input.userId);
    if (existing?.status === 'completed') return { status: 'completed', blockers: [] };
    if (existing?.status === 'processing' && existing.processingToken !== null) {
      return { status: 'in_progress', blockers: [] };
    }

    const previewFlight = await this.repository.getFlight(input.userId);
    const blockers = toRequestBlockers(previewFlight, input);
    if (blockers.length > 0) {
      const recorded = await this.repository.recordBlocked(
        input.userId,
        blockers.map((blocker) => blocker.code),
      );
      return recorded ? { status: 'blocked', blockers } : { status: 'in_progress', blockers: [] };
    }

    const claim = await this.repository.claimRequest({
      userId: input.userId,
      identityId: input.identityId,
      processingToken: randomUUID(),
      acknowledgePersonalSubscriptions: input.acknowledgePersonalSubscriptions,
      acknowledgeStoreBilling: input.acknowledgeStoreBilling,
      acknowledgePersonalAssets: input.acknowledgePersonalAssets,
    });
    if (claim.kind === 'completed') return { status: 'completed', blockers: [] };
    if (claim.kind === 'in_progress') return { status: 'in_progress', blockers: [] };
    if (claim.kind === 'blocked') {
      const concurrentBlockers = toRequestBlockers(claim.flight, input);
      await this.repository.recordBlocked(
        input.userId,
        concurrentBlockers.map((blocker) => blocker.code),
      );
      return { status: 'blocked', blockers: concurrentBlockers };
    }
    return this.resumeClaimedRequest(claim.request);
  }

  public async recoverPendingRequests(limit: number): Promise<{
    attemptedCount: number;
    completedCount: number;
  }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Legacy account deletion recovery limit must be between 1 and 100');
    }
    let attemptedCount = 0;
    let completedCount = 0;
    const attemptedUserIds: string[] = [];
    for (let index = 0; index < limit; index += 1) {
      const request = await this.repository.claimNextPending(randomUUID(), attemptedUserIds);
      if (request === null) break;
      attemptedUserIds.push(request.userId);
      attemptedCount += 1;
      const result = await this.resumeClaimedRequest(request);
      if (result.status === 'completed') completedCount += 1;
    }
    return { attemptedCount, completedCount };
  }

  private async resumeClaimedRequest(
    request: LegacyAccountDeletionRequestRecord,
  ): Promise<AccountDeletionResult> {
    const token = request.processingToken;
    if (token === null) return { status: 'in_progress', blockers: [] };
    const budget: AttemptBudget = { startedAt: this.now(), externalSteps: 0 };

    for (let pass = 0; pass < 3; pass += 1) {
      const flight = await this.repository.getFlight(request.userId);
      const hardBlockers = toHardBlockers(flight);
      if (hardBlockers.length > 0) {
        const updated = await this.repository.markClaimBlocked(
          request.userId,
          token,
          hardBlockers.map((blocker) => blocker.code),
        );
        return updated ? { status: 'blocked', blockers: hardBlockers } : { status: 'in_progress', blockers: [] };
      }

      for (const subscriptionId of flight.activePersonalStripeSubscriptionIds) {
        if (request.cancelledSubscriptionIds.includes(subscriptionId)) continue;
        const result = await this.runExternalStep(
          request,
          budget,
          'cancel_personal_subscriptions',
          (context) => this.subscriptions.cancelPersonalSubscription(subscriptionId, context),
          (context) => this.subscriptions.reconcilePersonalSubscriptionCancellation(subscriptionId, context),
          () => this.repository.markSubscriptionCancelled(request.userId, token, subscriptionId),
        );
        if (result !== null) return result;
        request.cancelledSubscriptionIds.push(subscriptionId);
      }

      for (const key of personalDeletionKeys(flight)) {
        if (request.scheduledAssetKeys.includes(key)) continue;
        const result = await this.runExternalStep(
          request,
          budget,
          'delete_personal_assets',
          (context) => this.assets.scheduleDeletion(key, context),
          (context) => this.assets.reconcileDeletionSchedule(key, context),
          () => this.repository.markAssetScheduled(request.userId, token, key),
        );
        if (result !== null) return result;
        request.scheduledAssetKeys.push(key);
      }

      const latest = await this.repository.getFlight(request.userId);
      const hasNewWork = latest.activePersonalStripeSubscriptionIds.some(
        (id) => !request.cancelledSubscriptionIds.includes(id),
      ) || personalDeletionKeys(latest).some((key) => !request.scheduledAssetKeys.includes(key));
      if (!hasNewWork) break;
      if (pass === 2) {
        return this.deferRequest(request, 'ATTEMPT_BUDGET_EXHAUSTED', 'delete_personal_assets');
      }
    }

    const finalFlight = await this.repository.getFlight(request.userId);
    const finalHardBlockers = toHardBlockers(finalFlight);
    if (finalHardBlockers.length > 0) {
      const updated = await this.repository.markClaimBlocked(
        request.userId,
        token,
        finalHardBlockers.map((blocker) => blocker.code),
      );
      return updated ? { status: 'blocked', blockers: finalHardBlockers } : { status: 'in_progress', blockers: [] };
    }

    if (!request.dataAnonymized) {
      try {
        if (!await this.repository.anonymizePersonalData(request.userId, token)) {
          return { status: 'in_progress', blockers: [] };
        }
        request.dataAnonymized = true;
      } catch {
        return this.deferRequest(request, 'ANONYMIZE_PERSONAL_DATA_FAILED', 'anonymize_personal_data');
      }
    }

    if (!request.identityDisabled) {
      const result = await this.runExternalStep(
        request,
        budget,
        'disable_identity',
        (context) => this.identity.disableIdentity(request.identityId, context),
        (context) => this.identity.reconcileIdentityDisabled(request.identityId, context),
        () => this.repository.markIdentityDisabled(request.userId, token),
      );
      if (result !== null) return result;
      request.identityDisabled = true;
    }

    if (!request.identityDeleted) {
      const result = await this.runExternalStep(
        request,
        budget,
        'delete_identity',
        (context) => this.identity.deleteIdentity(request.identityId, context),
        (context) => this.identity.reconcileIdentityDeleted(request.identityId, context),
        () => this.repository.markIdentityDeleted(request.userId, token),
      );
      if (result !== null) return result;
      request.identityDeleted = true;
    }

    return await this.repository.markCompleted(request.userId, token)
      ? { status: 'completed', blockers: [] }
      : { status: 'in_progress', blockers: [] };
  }

  private async runExternalStep(
    request: LegacyAccountDeletionRequestRecord,
    budget: AttemptBudget,
    nextAction: AccountDeletionNextAction,
    operation: (context: LegacyAccountDeletionExternalCallContext) => Promise<void>,
    reconcile: (
      context: LegacyAccountDeletionExternalCallContext,
    ) => Promise<LegacyAccountDeletionExternalEffectState>,
    checkpoint: () => Promise<boolean>,
  ): Promise<AccountDeletionResult | null> {
    if (
      budget.externalSteps >= this.maxExternalStepsPerAttempt
      || this.now() - budget.startedAt >= this.attemptTimeBudgetMs
    ) {
      return this.deferRequest(request, 'ATTEMPT_BUDGET_EXHAUSTED', nextAction);
    }
    budget.externalSteps += 1;

    const operationResult = await this.runBoundedExternalCall(budget, operation);
    if (operationResult.kind === 'completed') return this.persistExternalCheckpoint(checkpoint);

    const reconciliation = await this.runBoundedExternalCall(budget, reconcile);
    if (reconciliation.kind !== 'completed' || reconciliation.value !== 'applied') {
      return { status: 'in_progress', blockers: [] };
    }
    return this.persistExternalCheckpoint(checkpoint);
  }

  private async persistExternalCheckpoint(
    checkpoint: () => Promise<boolean>,
  ): Promise<AccountDeletionResult | null> {
    try {
      return await checkpoint() ? null : { status: 'in_progress', blockers: [] };
    } catch {
      return { status: 'in_progress', blockers: [] };
    }
  }

  private async runBoundedExternalCall<T>(
    budget: AttemptBudget,
    operation: (context: LegacyAccountDeletionExternalCallContext) => Promise<T>,
  ): Promise<BoundedExternalCallResult<T>> {
    const remainingBudgetMs = this.attemptTimeBudgetMs - (this.now() - budget.startedAt);
    if (remainingBudgetMs <= 0) return { kind: 'unknown' };
    const timeoutMs = Math.min(this.externalCallTimeoutMs, remainingBudgetMs);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const operationResult: Promise<BoundedExternalCallResult<T>> = (async () => {
      try {
        const value = await operation({
          signal: controller.signal,
          deadlineAt: this.now() + timeoutMs,
        });
        return { kind: 'completed', value };
      } catch {
        return { kind: 'unknown' };
      }
    })();
    const timeoutResult = new Promise<BoundedExternalCallResult<T>>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve({ kind: 'unknown' });
      }, timeoutMs);
    });
    const result = await Promise.race([operationResult, timeoutResult]);
    if (timeout !== undefined) clearTimeout(timeout);
    return result;
  }

  private async deferRequest(
    request: LegacyAccountDeletionRequestRecord,
    failureCode: string,
    nextAction: AccountDeletionNextAction,
  ): Promise<AccountDeletionResult> {
    if (request.processingToken === null) return { status: 'in_progress', blockers: [] };
    return await this.repository.recordFailure(request.userId, request.processingToken, failureCode)
      ? { status: 'pending_external_action', blockers: [], next_action: nextAction }
      : { status: 'in_progress', blockers: [] };
  }
}

interface AttemptBudget { startedAt: number; externalSteps: number }
type BoundedExternalCallResult<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'unknown' };

function toRequestBlockers(
  flight: LegacyAccountDeletionFlight,
  input: Pick<AccountDeletionRequestInput,
  'acknowledgePersonalSubscriptions' | 'acknowledgeStoreBilling' | 'acknowledgePersonalAssets'>,
): AccountDeletionBlocker[] {
  const blockers = toHardBlockers(flight);
  if (flight.activePersonalStripeSubscriptionIds.length > 0 && !input.acknowledgePersonalSubscriptions) {
    blockers.push({ code: 'ACTIVE_PERSONAL_SUBSCRIPTION', subscription_count: flight.activePersonalStripeSubscriptionIds.length });
  }
  if (flight.activeStoreSubscriptions.length > 0 && !input.acknowledgeStoreBilling) {
    blockers.push({ code: 'ACTIVE_STORE_SUBSCRIPTION', subscription_count: flight.activeStoreSubscriptions.length });
  }
  if (flight.personalAssetKeys.length > 0 && !input.acknowledgePersonalAssets) {
    blockers.push({ code: 'PERSONAL_ASSETS', asset_count: flight.personalAssetKeys.length });
  }
  return blockers;
}

function personalDeletionKeys(flight: LegacyAccountDeletionFlight): string[] {
  return [...new Set([...flight.personalAssetKeys, ...flight.personalTemporaryUploadKeys])];
}

function toHardBlockers(flight: LegacyAccountDeletionFlight): AccountDeletionBlocker[] {
  const blockers: AccountDeletionBlocker[] = [];
  if (flight.uniqueOwnerOrganizations.length > 0) {
    blockers.push({ code: 'UNIQUE_ORGANIZATION_OWNER', organizations: flight.uniqueOwnerOrganizations.slice(0, 25) });
  }
  const activeJobs = flight.activePersonalGenerationJobCount + flight.activePersonalExportJobCount + flight.activePersonalUploadCount;
  if (activeJobs > 0) blockers.push({ code: 'ACTIVE_PERSONAL_JOB', job_count: activeJobs });
  return blockers;
}
