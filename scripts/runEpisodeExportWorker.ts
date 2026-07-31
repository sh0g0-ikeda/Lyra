import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigurationError } from '../src/domain/errors/index.js';
import {
  SqsEpisodeExportQueue,
} from '../src/infrastructure/aws/SqsEpisodeExportQueue.js';
import { closeDatabasePool } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import { assertProductionRuntimeConfig } from '../src/lib/runtimeGuards.js';
import {
  EpisodeExportCleanupService,
} from '../src/services/export/EpisodeExportCleanupService.js';
import {
  EpisodeExportDispatchService,
} from '../src/services/export/EpisodeExportDispatchService.js';
import {
  resolveEpisodeExportWorkerDependencies,
} from '../worker/episodeExportDependencies.js';
import {
  EpisodeExportQueuePoller,
} from '../worker/episodeExportSqsPoller.js';

const RECOVERY_INTERVAL_MS = 5 * 60 * 1000;
const DISPATCH_BATCH_LIMIT = 50;
const CLEANUP_BATCH_LIMIT = 100;

async function main(): Promise<void> {
  assertProductionRuntimeConfig(env);
  if (!env.EPISODE_EXPORT_ENABLED) {
    throw new ConfigurationError(
      'EPISODE_EXPORT_ENABLED=true is required for the episode export worker',
    );
  }
  if (env.SQS_QUEUE_URL_EXPORT === undefined) {
    throw new ConfigurationError(
      'SQS_QUEUE_URL_EXPORT is required for episode export worker polling',
    );
  }

  const sqsClient = new SQSClient(
    env.AWS_REGION === undefined ? {} : { region: env.AWS_REGION },
  );
  const dependencies = resolveEpisodeExportWorkerDependencies();
  const dispatcher = new EpisodeExportDispatchService(
    dependencies.repository,
    new SqsEpisodeExportQueue(sqsClient, env.SQS_QUEUE_URL_EXPORT),
  );
  const cleanup = new EpisodeExportCleanupService(
    dependencies.repository,
    dependencies.artifactStorage,
  );
  const recovery = new EpisodeExportRecoveryRunner(dispatcher, cleanup);
  await recovery.run('startup');

  const poller = new EpisodeExportQueuePoller(
    sqsClient,
    dependencies,
    {
      queueUrl: env.SQS_QUEUE_URL_EXPORT,
      maxNumberOfMessages: env.SQS_EXPORT_MAX_NUMBER_OF_MESSAGES,
      visibilityTimeoutSeconds: env.SQS_EXPORT_VISIBILITY_TIMEOUT_SECONDS,
    },
  );
  process.once('SIGINT', () => poller.stop());
  process.once('SIGTERM', () => poller.stop());

  const recoveryTimer = setInterval(() => {
    void recovery.run('periodic');
  }, RECOVERY_INTERVAL_MS);
  unrefTimer(recoveryTimer);

  try {
    console.info('[episode-export-worker] polling started');
    await poller.run();
  } finally {
    clearInterval(recoveryTimer);
    await closeDatabasePool();
    console.info('[episode-export-worker] polling stopped');
  }
}

class EpisodeExportRecoveryRunner {
  private inFlight = false;

  public constructor(
    private readonly dispatcher: EpisodeExportDispatchService,
    private readonly cleanup: EpisodeExportCleanupService,
  ) {}

  public async run(reason: 'startup' | 'periodic'): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const dispatched = await this.dispatcher.dispatchPending(
        DISPATCH_BATCH_LIMIT,
      );
      const cleaned = await this.cleanup.cleanupExpired(CLEANUP_BATCH_LIMIT);
      if (dispatched.attemptedCount > 0 || cleaned.selectedCount > 0) {
        console.info(
          `[episode-export-recovery] ${reason} dispatched ${dispatched.dispatchedCount}/${dispatched.attemptedCount}, cleaned ${cleaned.deletedCount}/${cleaned.selectedCount}`,
        );
      }
    } catch (error) {
      console.error(
        `[episode-export-recovery] ${reason} failed`,
        sanitizePersistedErrorMessage(
          error,
          'Episode export recovery failed',
        ),
      );
    } finally {
      this.inFlight = false;
    }
  }
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    timer.unref();
  }
}

void main().catch(async (error: unknown) => {
  console.error(
    sanitizePersistedErrorMessage(error, 'Episode export worker failed'),
  );
  await closeDatabasePool();
  process.exitCode = 1;
});
