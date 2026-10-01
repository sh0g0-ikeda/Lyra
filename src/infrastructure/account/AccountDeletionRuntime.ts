import { createCognitoAccountIdentityDeletion } from '../aws/CognitoAccountIdentityDeletion.js';
import { createS3AccountAssetDeletion } from '../aws/S3AccountAssetDeletion.js';
import { createStripeAccountSubscriptionCancellation } from '../stripe/StripeAccountSubscriptionCancellation.js';
import { resolveAccountDeletionConfig } from './AccountDeletionConfig.js';
import type { Env } from '../../lib/env.js';
import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import { PostgresAccountDeletionRepository } from '../../repositories/AccountDeletionRepository.js';
import type { PersonalStateReferenceFencingPort } from '../../services/entity/FencedStateReferenceConfirmationService.js';
import { AccountDeletionService } from '../../services/account/AccountDeletionService.js';
export interface AccountDeletionRecoveryRuntime {
  service: Pick<AccountDeletionService, 'recoverPendingRequests'>;
  intervalMs: number;
  batchSize: number;
}
/** Reuses the existing API execution environment. It only resumes durable,
 * previously user-confirmed deletion requests; it never creates new requests. */
export function createAccountDeletionRecoveryRuntime(environment: Env, database: DatabaseClient & TransactionRunner, stateReferenceFencing?: PersonalStateReferenceFencingPort): AccountDeletionRecoveryRuntime | null {
  const config = resolveAccountDeletionConfig(environment);
  if (config === null) return null;
  return { intervalMs: config.recoveryIntervalMs, batchSize: config.recoveryBatchSize,
    service: new AccountDeletionService(new PostgresAccountDeletionRepository(database, database),
      createStripeAccountSubscriptionCancellation(config.stripeSecretKey),
      createCognitoAccountIdentityDeletion({ region: config.region, userPoolId: config.userPoolId }),
      createS3AccountAssetDeletion({ region: config.region, bucket: config.bucket }), config.identityHashSecret, { stateReferenceFencing }),
  };
}
export function startAccountDeletionRecovery(runtime: AccountDeletionRecoveryRuntime | null): () => void {
  if (runtime === null) return () => undefined;
  if (!Number.isSafeInteger(runtime.intervalMs) || runtime.intervalMs < 5000 || !Number.isSafeInteger(runtime.batchSize) || runtime.batchSize < 1 || runtime.batchSize > 100)
    throw new Error('Invalid account deletion recovery configuration');
  let active = false; let stopped = false;
  const run = async (): Promise<void> => {
    if (active || stopped) return;
    active = true;
    try {
      const result = await runtime.service.recoverPendingRequests(runtime.batchSize);
      if (result.attemptedCount > 0) console.info(JSON.stringify({ event: 'account_deletion_recovery', ...result }));
    } catch {
      console.error('Account deletion recovery failed; durable request retained');
    } finally { active = false; }
  };
  void run();
  const timer = setInterval(() => { void run(); }, runtime.intervalMs);timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
