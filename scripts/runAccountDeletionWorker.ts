import {
  createCognitoAccountIdentityDeletion,
} from '../src/infrastructure/aws/CognitoAccountIdentityDeletion.js';
import {
  createS3AccountAssetDeletion,
} from '../src/infrastructure/aws/S3AccountAssetDeletion.js';
import {
  resolveAccountDeletionConfig,
} from '../src/infrastructure/account/AccountDeletionConfig.js';
import {
  createStripeAccountSubscriptionCancellation,
} from '../src/infrastructure/stripe/StripeAccountSubscriptionCancellation.js';
import { closeDatabasePool, db } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import { assertProductionRuntimeConfig } from '../src/lib/runtimeGuards.js';
import { PostgresAccountDeletionRepository } from '../src/repositories/AccountDeletionRepository.js';
import { AccountDeletionService } from '../src/services/account/AccountDeletionService.js';

async function main(): Promise<void> {
  assertProductionRuntimeConfig(env);
  const config = resolveAccountDeletionConfig(env);
  if (config === null) {
    throw new Error(
      'ACCOUNT_DELETION_ENABLED=true is required for the account deletion worker',
    );
  }

  const repository = new PostgresAccountDeletionRepository(db, db);
  const service = new AccountDeletionService(
    repository,
    createStripeAccountSubscriptionCancellation(config.stripeSecretKey),
    createCognitoAccountIdentityDeletion({
      region: config.region,
      userPoolId: config.userPoolId,
    }),
    createS3AccountAssetDeletion({
      region: config.region,
      bucket: config.bucket,
    }),
    config.identityHashSecret,
  );
  const runner = new AccountDeletionRecoveryRunner(
    service,
    config.recoveryBatchSize,
  );
  await runner.run('startup');

  let stop: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const timer = setInterval(() => {
    void runner.run('periodic');
  }, config.recoveryIntervalMs);
  process.once('SIGINT', () => stop?.());
  process.once('SIGTERM', () => stop?.());

  console.info('[account-deletion-worker] recovery polling started');
  try {
    await stopped;
  } finally {
    clearInterval(timer);
    await closeDatabasePool();
    console.info('[account-deletion-worker] recovery polling stopped');
  }
}

class AccountDeletionRecoveryRunner {
  private inFlight = false;

  public constructor(
    private readonly service: AccountDeletionService,
    private readonly batchSize: number,
  ) {}

  public async run(reason: 'startup' | 'periodic'): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const result = await this.service.recoverPendingRequests(this.batchSize);
      if (result.attemptedCount > 0) {
        console.info(
          `[account-deletion-recovery] ${reason} completed ${result.completedCount}/${result.attemptedCount}`,
        );
      }
    } catch (error) {
      console.error(
        `[account-deletion-recovery] ${reason} failed`,
        sanitizePersistedErrorMessage(
          error,
          'Account deletion recovery failed',
        ),
      );
    } finally {
      this.inFlight = false;
    }
  }
}

void main().catch(async (error: unknown) => {
  console.error(
    sanitizePersistedErrorMessage(error, 'Account deletion worker failed'),
  );
  await closeDatabasePool();
  process.exitCode = 1;
});
