import type { DatabaseClient } from '../../lib/db.js';

export type LegacyAccountDeletionStatus =
  | 'blocked'
  | 'processing'
  | 'pending_external_action'
  | 'completed';

export interface LegacyAccountDeletionStoreSubscription {
  store: 'apple' | 'google';
  expiresAt: Date | null;
  autoRenewEnabled: boolean | null;
}

export interface LegacyAccountDeletionExternalCallContext {
  signal: AbortSignal;
  deadlineAt: number;
}

/**
 * `unknown` includes a timed out write that may still commit remotely. The
 * caller must retain its processing owner and must not retry that effect.
 */
export type LegacyAccountDeletionExternalEffectState = 'applied' | 'unknown';

export interface LegacyAccountDeletionFlight {
  uniqueOwnerOrganizations: Array<{ id: string; name: string }>;
  activePersonalStripeSubscriptionIds: string[];
  activeStoreSubscriptions: LegacyAccountDeletionStoreSubscription[];
  personalAssetKeys: string[];
  activePersonalGenerationJobCount: number;
  activePersonalExportJobCount: number;
}

export interface LegacyAccountDeletionRequestRecord {
  userId: string;
  identityId: string;
  status: LegacyAccountDeletionStatus;
  processingToken: string | null;
  cancelledSubscriptionIds: string[];
  scheduledAssetKeys: string[];
  dataAnonymized: boolean;
  identityDisabled: boolean;
  identityDeleted: boolean;
}

export interface LegacyAccountDeletionClaimInput {
  userId: string;
  identityId: string;
  processingToken: string;
  acknowledgePersonalSubscriptions: boolean;
  acknowledgeStoreBilling: boolean;
  acknowledgePersonalAssets: boolean;
}

export type LegacyAccountDeletionClaimResult =
  | { kind: 'claimed'; request: LegacyAccountDeletionRequestRecord }
  | { kind: 'blocked'; flight: LegacyAccountDeletionFlight }
  | { kind: 'in_progress' }
  | { kind: 'completed' };

export interface LegacyAccountDeletionRepositoryPort {
  getFlight(userId: string): Promise<LegacyAccountDeletionFlight>;
  getRequest(userId: string): Promise<LegacyAccountDeletionRequestRecord | null>;
  recordBlocked(userId: string, blockerCodes: string[]): Promise<boolean>;
  markClaimBlocked(
    userId: string,
    processingToken: string,
    blockerCodes: string[],
  ): Promise<boolean>;
  claimRequest(input: LegacyAccountDeletionClaimInput): Promise<LegacyAccountDeletionClaimResult>;
  claimNextPending(
    processingToken: string,
    excludedUserIds?: readonly string[],
  ): Promise<LegacyAccountDeletionRequestRecord | null>;
  markSubscriptionCancelled(
    userId: string,
    processingToken: string,
    subscriptionId: string,
  ): Promise<boolean>;
  markAssetScheduled(userId: string, processingToken: string, key: string): Promise<boolean>;
  anonymizePersonalData(userId: string, processingToken: string): Promise<boolean>;
  markIdentityDisabled(userId: string, processingToken: string): Promise<boolean>;
  markIdentityDeleted(userId: string, processingToken: string): Promise<boolean>;
  markCompleted(userId: string, processingToken: string): Promise<boolean>;
  recordFailure(
    userId: string,
    processingToken: string,
    failureCode: string,
  ): Promise<boolean>;
}

export interface LegacyAccountDeletionTransactionContext {
  client: DatabaseClient;
}
