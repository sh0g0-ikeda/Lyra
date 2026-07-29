import { randomUUID } from 'node:crypto';
import type {
  AccountDeletionFlight,
  AccountDeletionRepository,
} from '../../repositories/AccountDeletionRepository.js';

const MAX_PREVIEW_OWNER_ORGANIZATIONS = 25;

export interface AccountSubscriptionCancellationPort {
  cancelSubscription(subscriptionId: string): Promise<void>;
}

export interface AccountIdentityDeletionPort {
  disableIdentity(subject: string): Promise<void>;
  deleteIdentity(subject: string): Promise<void>;
}

export interface AccountAssetLifecyclePort {
  scheduleDeletion(prefix: string): Promise<void>;
}

export interface AccountDeletionRequestInput {
  userId: string;
  identityId: string;
  confirmation: 'DELETE';
  acknowledgeActiveSubscription: boolean;
  acknowledgeConfirmedAssets: boolean;
}

export interface AccountDeletionPreview {
  personalData: {
    account: 'anonymized';
    personalWorks: 'deleted';
    organizationMemberships: 'removed';
  };
  uniqueOwnerOrganizations: Array<{ id: string; name: string }>;
  activePersonalSubscriptionCount: number;
  activeStripeSubscriptionCount: number;
  activeMobileStoreSubscriptionCount: number;
  confirmedPersonalAssetCount: number;
}

export type AccountDeletionBlocker =
  | {
      code: 'UNIQUE_ORGANIZATION_OWNER';
      organizations: Array<{ id: string; name: string }>;
    }
  | {
      code: 'ACTIVE_PERSONAL_SUBSCRIPTION';
      subscription_count: number;
    }
  | {
      code: 'CONFIRMED_PERSONAL_ASSETS';
      asset_count: number;
    };

export type AccountDeletionNextAction =
  | 'cancel_subscription'
  | 'disable_identity'
  | 'delete_identity'
  | 'schedule_asset_lifecycle'
  | 'anonymize_personal_data';

export type AccountDeletionResult =
  | { status: 'blocked'; blockers: AccountDeletionBlocker[] }
  | { status: 'in_progress'; blockers: [] }
  | { status: 'pending_external_action'; blockers: []; next_action: AccountDeletionNextAction }
  | { status: 'completed'; blockers: [] };

export interface AccountDeletionServicePort {
  getDeletionPreview(userId: string): Promise<AccountDeletionPreview>;
  requestDeletion(input: AccountDeletionRequestInput): Promise<AccountDeletionResult>;
}

/**
 * Coordinates an irreversible personal-account deletion. A durable request
 * claim prevents concurrent API calls from invoking the same provider twice.
 */
export class AccountDeletionService implements AccountDeletionServicePort {
  public constructor(
    private readonly repository: AccountDeletionRepository,
    private readonly subscriptions: AccountSubscriptionCancellationPort,
    private readonly identity: AccountIdentityDeletionPort,
    private readonly assets: AccountAssetLifecyclePort,
  ) {}

  public async getDeletionPreview(userId: string): Promise<AccountDeletionPreview> {
    const flight = await this.repository.getFlight(userId);
    return {
      personalData: {
        account: 'anonymized',
        personalWorks: 'deleted',
        organizationMemberships: 'removed',
      },
      uniqueOwnerOrganizations: flight.uniqueOwnerOrganizations.slice(0, MAX_PREVIEW_OWNER_ORGANIZATIONS),
      activePersonalSubscriptionCount: activeSubscriptionCount(flight),
      activeStripeSubscriptionCount: flight.activePersonalSubscriptionIds.length,
      activeMobileStoreSubscriptionCount: flight.activeMobileStoreSubscriptionCount,
      confirmedPersonalAssetCount: flight.confirmedAssetCount,
    };
  }

  public async requestDeletion(input: AccountDeletionRequestInput): Promise<AccountDeletionResult> {
    const existing = await this.repository.getRequest(input.userId);
    if (existing?.status === 'completed') {
      return { status: 'completed', blockers: [] };
    }

    const flight = await this.repository.getFlight(input.userId);
    const blockers = toBlockers(flight, input);
    if (blockers.length > 0) {
      await this.repository.recordBlocked(input.userId, blockers.map((blocker) => blocker.code));
      return { status: 'blocked', blockers };
    }

    const request = await this.repository.claimRequest({
      userId: input.userId,
      identityId: input.identityId,
      processingToken: randomUUID(),
    });
    if (request === null) {
      const current = await this.repository.getRequest(input.userId);
      if (current?.status === 'completed') {
        return { status: 'completed', blockers: [] };
      }
      return { status: 'in_progress', blockers: [] };
    }

    for (const subscriptionId of flight.activePersonalSubscriptionIds) {
      if (request.cancelledSubscriptionIds.includes(subscriptionId)) {
        continue;
      }
      const failure = await this.runExternalStep(input.userId, 'cancel_subscription', async () => {
        await this.subscriptions.cancelSubscription(subscriptionId);
        await this.repository.markSubscriptionCancelled(input.userId, subscriptionId);
      });
      if (failure !== null) {
        return failure;
      }
    }

    for (const key of flight.personalAssetKeys) {
      if (request.scheduledAssetKeys.includes(key)) {
        continue;
      }
      const failure = await this.runExternalStep(input.userId, 'schedule_asset_lifecycle', async () => {
        await this.assets.scheduleDeletion(key);
        await this.repository.markAssetKeyScheduled(input.userId, key);
      });
      if (failure !== null) {
        return failure;
      }
    }

    if (!request.dataAnonymized) {
      try {
        await this.repository.anonymizePersonalData(input.userId);
        request.dataAnonymized = true;
      } catch {
        await this.repository.recordExternalFailure(input.userId, 'ANONYMIZE_PERSONAL_DATA_FAILED');
        return { status: 'pending_external_action', blockers: [], next_action: 'anonymize_personal_data' };
      }
    }

    // Identity actions are last: no subsequent provider or asset work can make a user retry impossible.
    if (!request.identityDisabled) {
      const failure = await this.runExternalStep(input.userId, 'disable_identity', async () => {
        await this.identity.disableIdentity(request.identityId);
        await this.repository.markIdentityDisabled(input.userId);
      });
      if (failure !== null) {
        return failure;
      }
      request.identityDisabled = true;
    }

    if (!request.identityDeleted) {
      const failure = await this.runExternalStep(input.userId, 'delete_identity', async () => {
        await this.identity.deleteIdentity(request.identityId);
        await this.repository.markIdentityDeleted(input.userId);
      });
      if (failure !== null) {
        return failure;
      }
      request.identityDeleted = true;
    }

    await this.repository.markCompleted(input.userId);
    return { status: 'completed', blockers: [] };
  }

  private async runExternalStep(
    userId: string,
    action: AccountDeletionNextAction,
    work: () => Promise<void>,
  ): Promise<Extract<AccountDeletionResult, { status: 'pending_external_action' }> | null> {
    try {
      await work();
      return null;
    } catch {
      await this.repository.recordExternalFailure(userId, failureCodeFor(action));
      return { status: 'pending_external_action', blockers: [], next_action: action };
    }
  }
}

function toBlockers(
  flight: AccountDeletionFlight,
  input: AccountDeletionRequestInput,
): AccountDeletionBlocker[] {
  const blockers: AccountDeletionBlocker[] = [];
  if (flight.uniqueOwnerOrganizations.length > 0) {
    blockers.push({
      code: 'UNIQUE_ORGANIZATION_OWNER',
      organizations: flight.uniqueOwnerOrganizations.slice(0, MAX_PREVIEW_OWNER_ORGANIZATIONS),
    });
  }
  const subscriptionCount = activeSubscriptionCount(flight);
  if (subscriptionCount > 0 && !input.acknowledgeActiveSubscription) {
    blockers.push({
      code: 'ACTIVE_PERSONAL_SUBSCRIPTION',
      subscription_count: subscriptionCount,
    });
  }
  if (flight.confirmedAssetCount > 0 && !input.acknowledgeConfirmedAssets) {
    blockers.push({
      code: 'CONFIRMED_PERSONAL_ASSETS',
      asset_count: flight.confirmedAssetCount,
    });
  }
  return blockers;
}

function activeSubscriptionCount(flight: AccountDeletionFlight): number {
  return flight.activePersonalSubscriptionIds.length + flight.activeMobileStoreSubscriptionCount;
}

function failureCodeFor(action: AccountDeletionNextAction): string {
  switch (action) {
    case 'cancel_subscription':
      return 'CANCEL_SUBSCRIPTION_FAILED';
    case 'disable_identity':
      return 'DISABLE_IDENTITY_FAILED';
    case 'delete_identity':
      return 'DELETE_IDENTITY_FAILED';
    case 'schedule_asset_lifecycle':
      return 'SCHEDULE_ASSET_LIFECYCLE_FAILED';
    case 'anonymize_personal_data':
      return 'ANONYMIZE_PERSONAL_DATA_FAILED';
  }
}

export function createUnavailableAccountIdentityDeletionPort(): AccountIdentityDeletionPort {
  return {
    async disableIdentity(): Promise<never> {
      throw new Error('Account identity deletion adapter is not configured');
    },
    async deleteIdentity(): Promise<never> {
      throw new Error('Account identity deletion adapter is not configured');
    },
  };
}

export function createUnavailableAccountAssetLifecyclePort(): AccountAssetLifecyclePort {
  return {
    async scheduleDeletion(): Promise<never> {
      throw new Error('Account asset lifecycle adapter is not configured');
    },
  };
}

export function createStripeAccountSubscriptionCancellationPort(input: {
  cancelSubscription?: (subscriptionId: string) => Promise<void>;
}): AccountSubscriptionCancellationPort {
  return {
    async cancelSubscription(subscriptionId: string): Promise<void> {
      if (input.cancelSubscription === undefined) {
        throw new Error('Stripe subscription cancellation adapter is not configured');
      }
      await input.cancelSubscription(subscriptionId);
    },
  };
}
