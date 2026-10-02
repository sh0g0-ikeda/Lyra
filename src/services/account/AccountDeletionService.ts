import { randomUUID } from 'node:crypto';
import { isReservedFencedStateReferenceNamespace } from '../../domain/state/FencedStateReferenceKey.js';
import type { FencedStorageOperationBudget } from '../../infrastructure/aws/FencedStateReferenceStorage.js';
import type { PersonalStateReferenceFencingPort } from '../entity/FencedStateReferenceConfirmationService.js';
import { createAccountDeletionIdentityKey } from '../../domain/accountDeletion.js';
import type {
  AccountDeletionFlight,
  AccountDeletionRepository,
  AccountDeletionRequestRecord,
} from '../../repositories/AccountDeletionRepository.js';

const MAX_PREVIEW_ORGANIZATIONS = 25;
const DEFAULT_MAX_EXTERNAL_STEPS_PER_ATTEMPT = 25;
const DEFAULT_ATTEMPT_TIME_BUDGET_MS = 15_000;

export interface AccountSubscriptionCancellationPort {
  cancelPersonalSubscription(subscriptionId: string): Promise<void>;
}

export interface AccountIdentityDeletionPort {
  disableIdentity(identityId: string): Promise<void>;
  deleteIdentity(identityId: string): Promise<void>;
}

export interface AccountAssetDeletionPort {
  deleteExactObject(key: string): Promise<void>;
}

export interface AccountDeletionRequestInput {
  userId: string;
  identityId: string;
  confirmation: 'DELETE';
  acknowledgePersonalSubscriptions: boolean;
  acknowledgeStoreBilling: boolean;
  acknowledgePersonalAssets: boolean;
}

export interface AccountDeletionPreview {
  personalData: {
    account: 'anonymized';
    personalWorks: 'deleted';
    organizationMemberships: 'removed';
    billingRecords: 'retained_for_legal_and_security';
  };
  uniqueOwnerOrganizations: Array<{ id: string; name: string }>;
  activePersonalStripeSubscriptionCount: number;
  activeStoreSubscriptions: Array<{
    store: 'apple' | 'google';
    expiresAt: Date | null;
    autoRenewEnabled: boolean | null;
    manageUrl: string;
  }>;
  personalAssetCount: number;
  activePersonalJobCount: number;
}

export type AccountDeletionBlocker =
  | {
      code: 'UNIQUE_ORGANIZATION_OWNER';
      organizations: Array<{ id: string; name: string }>;
    }
  | { code: 'ACTIVE_PERSONAL_JOB'; job_count: number }
  | { code: 'ACTIVE_PERSONAL_SUBSCRIPTION'; subscription_count: number }
  | { code: 'ACTIVE_STORE_SUBSCRIPTION'; subscription_count: number }
  | { code: 'PERSONAL_ASSETS'; asset_count: number };

export type AccountDeletionNextAction =
  | 'cancel_personal_subscriptions'
  | 'delete_personal_assets'
  | 'anonymize_personal_data'
  | 'disable_identity'
  | 'delete_identity';

export type AccountDeletionResult =
  | { status: 'blocked'; blockers: AccountDeletionBlocker[] }
  | { status: 'in_progress'; blockers: [] }
  | {
      status: 'pending_external_action';
      blockers: [];
      next_action: AccountDeletionNextAction;
    }
  | { status: 'completed'; blockers: [] };

export interface AccountDeletionServicePort {
  getDeletionPreview(userId: string): Promise<AccountDeletionPreview>;
  requestDeletion(input: AccountDeletionRequestInput): Promise<AccountDeletionResult>;
}

export interface AccountDeletionServiceOptions {
  stateReferenceFencing?: PersonalStateReferenceFencingPort;
  maxExternalStepsPerAttempt?: number;
  attemptTimeBudgetMs?: number;
  now?: () => number;
}

export class AccountDeletionService implements AccountDeletionServicePort {
  private readonly maxExternalStepsPerAttempt: number;
  private readonly attemptTimeBudgetMs: number;
  private readonly now: () => number;
  private readonly stateReferenceFencing?: PersonalStateReferenceFencingPort;

  public constructor(
    private readonly repository: AccountDeletionRepository,
    private readonly subscriptions: AccountSubscriptionCancellationPort,
    private readonly identity: AccountIdentityDeletionPort,
    private readonly assets: AccountAssetDeletionPort,
    private readonly identityKeySecret: string,
    options: AccountDeletionServiceOptions = {},
  ) {
    this.maxExternalStepsPerAttempt =
      options.maxExternalStepsPerAttempt
      ?? DEFAULT_MAX_EXTERNAL_STEPS_PER_ATTEMPT;
    this.attemptTimeBudgetMs =
      options.attemptTimeBudgetMs
      ?? DEFAULT_ATTEMPT_TIME_BUDGET_MS;
    this.now = options.now ?? Date.now;
    this.stateReferenceFencing = options.stateReferenceFencing;
    if (
      !Number.isSafeInteger(this.maxExternalStepsPerAttempt)
      || this.maxExternalStepsPerAttempt < 1
      || this.maxExternalStepsPerAttempt > 100
      || !Number.isSafeInteger(this.attemptTimeBudgetMs)
      || this.attemptTimeBudgetMs < 1_000
      || this.attemptTimeBudgetMs > 60_000
    ) {
      throw new Error('Account deletion attempt budget is invalid');
    }
  }

  public async getDeletionPreview(userId: string): Promise<AccountDeletionPreview> {
    const flight = await this.repository.getFlight(userId);
    return {
      personalData: {
        account: 'anonymized',
        personalWorks: 'deleted',
        organizationMemberships: 'removed',
        billingRecords: 'retained_for_legal_and_security',
      },
      uniqueOwnerOrganizations: flight.uniqueOwnerOrganizations.slice(
        0,
        MAX_PREVIEW_ORGANIZATIONS,
      ),
      activePersonalStripeSubscriptionCount:
        flight.activePersonalStripeSubscriptionIds.length,
      activeStoreSubscriptions: flight.activeStoreSubscriptions.map(
        (subscription) => ({
          ...subscription,
          manageUrl:
            subscription.store === 'apple'
              ? 'https://apps.apple.com/account/subscriptions'
              : 'https://play.google.com/store/account/subscriptions',
        }),
      ),
      personalAssetCount: personalAssetCount(flight),
      activePersonalJobCount:
        flight.activePersonalGenerationJobCount
        + flight.activePersonalExportJobCount,
    };
  }

  public async requestDeletion(
    input: AccountDeletionRequestInput,
  ): Promise<AccountDeletionResult> {
    const existing = await this.repository.getRequest(input.userId);
    if (existing?.status === 'completed') {
      return { status: 'completed', blockers: [] };
    }
    if (
      existing !== null
      && existing.status !== 'blocked'
      && existing.processingToken.length === 0
    ) {
      return { status: 'in_progress', blockers: [] };
    }

    const flight = await this.repository.getFlight(input.userId);
    const blockers = toBlockers(flight, input);
    if (blockers.length > 0) {
      await this.repository.recordBlocked(
        input.userId,
        blockers.map((blocker) => blocker.code),
      );
      return { status: 'blocked', blockers };
    }

    const processingToken = randomUUID();
    const claim = await this.repository.claimRequest({
      userId: input.userId,
      identityId: input.identityId,
      identityKey: createAccountDeletionIdentityKey(
        this.identityKeySecret,
        input.identityId,
      ),
      processingToken,
      acknowledgePersonalSubscriptions:
        input.acknowledgePersonalSubscriptions,
      acknowledgeStoreBilling: input.acknowledgeStoreBilling,
      acknowledgePersonalAssets: input.acknowledgePersonalAssets,
    });
    if (claim.kind === 'completed') {
      return { status: 'completed', blockers: [] };
    }
    if (claim.kind === 'in_progress') {
      return { status: 'in_progress', blockers: [] };
    }
    if (claim.kind === 'blocked') {
      const concurrentBlockers = toBlockers(claim.flight, input);
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
      throw new Error('Account deletion recovery limit must be between 1 and 100');
    }
    let attemptedCount = 0;
    let completedCount = 0;
    for (let index = 0; index < limit; index += 1) {
      const request = await this.repository.claimNextRecoverable(randomUUID());
      if (request === null) {
        break;
      }
      attemptedCount += 1;
      const result = await this.resumeClaimedRequest(request);
      if (result.status === 'completed') {
        completedCount += 1;
      }
    }
    return { attemptedCount, completedCount };
  }

  private async resumeClaimedRequest(
    request: AccountDeletionRequestRecord,
    budget = new AccountDeletionAttemptBudget(
      this.maxExternalStepsPerAttempt,
      this.attemptTimeBudgetMs,
      this.now,
    ),
  ): Promise<AccountDeletionResult> {
    let latest = request;
    let flight = await this.repository.getFlight(request.userId);
    // A recovered/legacy claim may predate durable state-copy fencing. Recheck
    // before any irreversible external action, not only before anonymization.
    // Historical deleted-key checkpoints do not prove a late write cannot occur.
    if (flight.activePersonalGenerationJobCount > 0 || flight.activePersonalExportJobCount > 0
      || flight.uniqueOwnerOrganizations.length > 0) {
      await this.repository.recordFailure(request.userId, request.processingToken, 'EXTERNAL_REVALIDATION_BLOCKED');
      return { status: 'pending_external_action', blockers: [], next_action: 'anonymize_personal_data' };
    }

    // The journal's proof is independent of scheduled/deleted key checkpoints.
    // The adapter, not this service, charges every nested v2 SDK request.
    if ((flight.personalStateReferenceCount ?? 0) > 0) {
      const continuation = await this.releaseIfBudgetExhausted(latest, budget, 'delete_personal_assets');
      if (continuation !== null) return continuation;
      try {
        if (this.stateReferenceFencing === undefined
          || !await this.stateReferenceFencing.fencePersonalReferences(latest.userId, latest.processingToken, budget)) {
          throw new Error('State reference fencing is incomplete');
        }
        flight = await this.repository.getFlight(request.userId);
        if ((flight.personalStateReferenceCount ?? 0) > 0) throw new Error('State reference evidence is incomplete');
      } catch {
        if (budget.wasExhausted()) {
          return this.releaseContinuation(latest, 'delete_personal_assets');
        }
        await this.repository.recordFailure(latest.userId, latest.processingToken, 'FENCE_PERSONAL_STATE_REFERENCES_FAILED');
        return { status: 'pending_external_action', blockers: [], next_action: 'delete_personal_assets' };
      }
    }
    if (flight.personalAssetKeys.some(isReservedFencedStateReferenceNamespace)) {
      await this.repository.recordFailure(latest.userId, latest.processingToken, 'DELETE_PERSONAL_ASSET_FAILED');
      return { status: 'pending_external_action', blockers: [], next_action: 'delete_personal_assets' };
    }

    for (const subscriptionId of flight.activePersonalStripeSubscriptionIds) {
      if (latest.cancelledSubscriptionIds.includes(subscriptionId)) {
        continue;
      }
      const continuation = await this.releaseIfBudgetExhausted(
        latest,
        budget,
        'cancel_personal_subscriptions',
      );
      if (continuation !== null) {
        return continuation;
      }
      const failed = await this.runExternalStep(
        latest,
        'CANCEL_PERSONAL_SUBSCRIPTION_FAILED',
        'cancel_personal_subscriptions',
        async () => {
          budget.beforeRequest();
          await this.subscriptions.cancelPersonalSubscription(subscriptionId);
          await this.repository.markSubscriptionCancelled(
            latest.userId,
            latest.processingToken,
            subscriptionId,
          );
          latest.cancelledSubscriptionIds.push(subscriptionId);
        },
      );
      if (failed !== null) {
        return failed;
      }
    }

    for (const key of flight.personalAssetKeys) {
      if (latest.deletedAssetKeys.includes(key)) {
        continue;
      }
      const continuation = await this.releaseIfBudgetExhausted(
        latest,
        budget,
        'delete_personal_assets',
      );
      if (continuation !== null) {
        return continuation;
      }
      const failed = await this.runExternalStep(
        latest,
        'DELETE_PERSONAL_ASSET_FAILED',
        'delete_personal_assets',
        async () => {
          assertLegacyAssetKey(key);
          budget.beforeRequest();
          await this.assets.deleteExactObject(key);
          await this.repository.markAssetDeleted(
            latest.userId,
            latest.processingToken,
            key,
          );
          latest.deletedAssetKeys.push(key);
        },
      );
      if (failed !== null) {
        return failed;
      }
    }

    // Even a recovered anonymized checkpoint must revalidate and scrub v2.
    const finalized = await this.repository.finalizePersonalData(
      latest.userId,
      latest.processingToken,
    );
    if (finalized.kind === 'blocked') {
      await this.repository.recordFailure(
        latest.userId,
        latest.processingToken,
        'FINAL_REVALIDATION_BLOCKED',
      );
      return {
        status: 'pending_external_action',
        blockers: [],
        next_action: 'anonymize_personal_data',
      };
    }
    if (finalized.kind === 'uncancelled_subscriptions') {
      for (const subscriptionId of finalized.subscriptionIds) {
        const continuation = await this.releaseIfBudgetExhausted(
          latest,
          budget,
          'cancel_personal_subscriptions',
        );
        if (continuation !== null) {
          return continuation;
        }
        const failed = await this.runExternalStep(
          latest,
          'CANCEL_PERSONAL_SUBSCRIPTION_FAILED',
          'cancel_personal_subscriptions',
          async () => {
            budget.beforeRequest();
            await this.subscriptions.cancelPersonalSubscription(subscriptionId);
            await this.repository.markSubscriptionCancelled(
              latest.userId,
              latest.processingToken,
              subscriptionId,
            );
            latest.cancelledSubscriptionIds.push(subscriptionId);
          },
        );
        if (failed !== null) {
          return failed;
        }
      }
      return this.retryFinalization(latest, budget);
    }
    if (finalized.kind === 'new_assets') {
      for (const key of finalized.assetKeys) {
        const continuation = await this.releaseIfBudgetExhausted(
          latest,
          budget,
          'delete_personal_assets',
        );
        if (continuation !== null) {
          return continuation;
        }
        const failed = await this.runExternalStep(
          latest,
          'DELETE_PERSONAL_ASSET_FAILED',
          'delete_personal_assets',
          async () => {
            assertLegacyAssetKey(key);
            budget.beforeRequest();
            await this.assets.deleteExactObject(key);
            await this.repository.markAssetDeleted(
              latest.userId,
              latest.processingToken,
              key,
            );
            latest.deletedAssetKeys.push(key);
          },
        );
        if (failed !== null) {
          return failed;
        }
      }
      return this.retryFinalization(latest, budget);
    }
    latest = { ...latest, dataAnonymized: true };

    if (!latest.identityDisabled) {
      const continuation = await this.releaseIfBudgetExhausted(
        latest,
        budget,
        'disable_identity',
      );
      if (continuation !== null) {
        return continuation;
      }
      const failed = await this.runExternalStep(
        latest,
        'DISABLE_IDENTITY_FAILED',
        'disable_identity',
        async () => {
          budget.beforeRequest();
          await this.identity.disableIdentity(latest.identityId);
          await this.repository.markIdentityDisabled(
            latest.userId,
            latest.processingToken,
          );
          latest = { ...latest, identityDisabled: true };
        },
      );
      if (failed !== null) {
        return failed;
      }
    }

    if (!latest.identityDeleted) {
      const continuation = await this.releaseIfBudgetExhausted(
        latest,
        budget,
        'delete_identity',
      );
      if (continuation !== null) {
        return continuation;
      }
      const failed = await this.runExternalStep(
        latest,
        'DELETE_IDENTITY_FAILED',
        'delete_identity',
        async () => {
          budget.beforeRequest();
          await this.identity.deleteIdentity(latest.identityId);
          await this.repository.markIdentityDeleted(
            latest.userId,
            latest.processingToken,
          );
          latest = { ...latest, identityDeleted: true };
        },
      );
      if (failed !== null) {
        return failed;
      }
    }

    await this.repository.markCompleted(
      latest.userId,
      latest.processingToken,
    );
    return { status: 'completed', blockers: [] };
  }

  private async retryFinalization(
    request: AccountDeletionRequestRecord,
    budget: AccountDeletionAttemptBudget,
  ): Promise<AccountDeletionResult> {
    const finalized = await this.repository.finalizePersonalData(
      request.userId,
      request.processingToken,
    );
    if (finalized.kind !== 'completed') {
      await this.repository.recordFailure(
        request.userId,
        request.processingToken,
        'FINAL_REVALIDATION_CHANGED',
      );
      return {
        status: 'pending_external_action',
        blockers: [],
        next_action: 'anonymize_personal_data',
      };
    }
    return this.resumeClaimedRequest(
      { ...request, dataAnonymized: true },
      budget,
    );
  }

  private async releaseIfBudgetExhausted(
    request: AccountDeletionRequestRecord,
    budget: AccountDeletionAttemptBudget,
    nextAction: AccountDeletionNextAction,
  ): Promise<
    Extract<AccountDeletionResult, { status: 'pending_external_action' }> | null
  > {
    if (budget.canStartExternalStep()) {
      return null;
    }
    return this.releaseContinuation(request, nextAction);
  }

  private async releaseContinuation(
    request: AccountDeletionRequestRecord,
    nextAction: AccountDeletionNextAction,
  ): Promise<Extract<AccountDeletionResult, { status: 'pending_external_action' }>> {
    await this.repository.releaseForContinuation(
      request.userId,
      request.processingToken,
    );
    return {
      status: 'pending_external_action',
      blockers: [],
      next_action: nextAction,
    };
  }

  private async runExternalStep(
    request: AccountDeletionRequestRecord,
    failureCode: string,
    nextAction: AccountDeletionNextAction,
    work: () => Promise<void>,
  ): Promise<
    Extract<AccountDeletionResult, { status: 'pending_external_action' }> | null
  > {
    try {
      await work();
      return null;
    } catch (error) {
      if (error instanceof AccountDeletionBudgetExhaustedError) return this.releaseContinuation(request, nextAction);
      await this.repository.recordFailure(
        request.userId,
        request.processingToken,
        failureCode,
      );
      return {
        status: 'pending_external_action',
        blockers: [],
        next_action: nextAction,
      };
    }
  }
}

class AccountDeletionBudgetExhaustedError extends Error {
  public constructor() { super('Account deletion attempt budget exhausted'); }
}

class AccountDeletionAttemptBudget implements FencedStorageOperationBudget {
  private readonly startedAt: number;
  private startedExternalSteps = 0;
  private requestRejected = false;

  public constructor(
    private readonly maxExternalSteps: number,
    private readonly timeBudgetMs: number,
    private readonly now: () => number,
  ) {
    this.startedAt = now();
  }

  public canStartExternalStep(): boolean {
    return (
      this.startedExternalSteps < this.maxExternalSteps
      && this.remainingTimeMs() > 0
    );
  }

  public beforeRequest(): void {
    if (!this.canStartExternalStep()) {
      this.requestRejected = true;
      throw new AccountDeletionBudgetExhaustedError();
    }
    this.startedExternalSteps += 1;
  }

  public remainingTimeMs(): number {
    return Math.max(0, this.timeBudgetMs - (this.now() - this.startedAt));
  }

  public wasExhausted(): boolean {
    return this.requestRejected || !this.canStartExternalStep();
  }
}

function toBlockers(
  flight: AccountDeletionFlight,
  input: Pick<
    AccountDeletionRequestInput,
    | 'acknowledgePersonalSubscriptions'
    | 'acknowledgeStoreBilling'
    | 'acknowledgePersonalAssets'
  >,
): AccountDeletionBlocker[] {
  const blockers: AccountDeletionBlocker[] = [];
  if (flight.uniqueOwnerOrganizations.length > 0) {
    blockers.push({
      code: 'UNIQUE_ORGANIZATION_OWNER',
      organizations: flight.uniqueOwnerOrganizations.slice(
        0,
        MAX_PREVIEW_ORGANIZATIONS,
      ),
    });
  }
  const activeJobCount =
    flight.activePersonalGenerationJobCount
    + flight.activePersonalExportJobCount;
  if (activeJobCount > 0) {
    blockers.push({ code: 'ACTIVE_PERSONAL_JOB', job_count: activeJobCount });
  }
  if (
    flight.activePersonalStripeSubscriptionIds.length > 0
    && !input.acknowledgePersonalSubscriptions
  ) {
    blockers.push({
      code: 'ACTIVE_PERSONAL_SUBSCRIPTION',
      subscription_count: flight.activePersonalStripeSubscriptionIds.length,
    });
  }
  if (
    flight.activeStoreSubscriptions.length > 0
    && !input.acknowledgeStoreBilling
  ) {
    blockers.push({
      code: 'ACTIVE_STORE_SUBSCRIPTION',
      subscription_count: flight.activeStoreSubscriptions.length,
    });
  }
  if (
    personalAssetCount(flight) > 0
    && !input.acknowledgePersonalAssets
  ) {
    blockers.push({
      code: 'PERSONAL_ASSETS',
      asset_count: personalAssetCount(flight),
    });
  }
  return blockers;
}

function personalAssetCount(flight: AccountDeletionFlight): number {
  return flight.personalAssetKeys.length + (flight.personalStateReferenceCount ?? 0);
}

function assertLegacyAssetKey(key: string): void {
  if (isReservedFencedStateReferenceNamespace(key)) throw new Error('Reserved state reference asset requires fencing');
}
