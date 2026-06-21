import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigurationError } from '../src/domain/errors/index.js';
import { env } from '../src/lib/env.js';
import { closeDatabasePool, db } from '../src/lib/db.js';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import {
  GENERATION_RECOVERY_BATCH_LIMIT,
  PAGE_GENERATION_STALE_AFTER_MS,
} from '../src/domain/constants/generation.js';
import { PostgresCreditRepository } from '../src/repositories/CreditRepository.js';
import { PostgresPageGenerationExecutionRepository } from '../src/repositories/PageGenerationExecutionRepository.js';
import { PostgresPageGenerationRecoveryRepository } from '../src/repositories/PageGenerationRecoveryRepository.js';
import { CreditService } from '../src/services/credit/CreditService.js';
import { PageGenerationRecoveryService } from '../src/services/page/PageGenerationRecoveryService.js';
import { resolveWorkerDependencies } from '../worker/dependencies.js';
import { GenerationQueuePoller } from '../worker/sqsPoller.js';

const PAGE_GENERATION_RECOVERY_INTERVAL_MS = Math.min(
  PAGE_GENERATION_STALE_AFTER_MS,
  5 * 60 * 1000,
);

async function main(): Promise<void> {
  if (env.SQS_QUEUE_URL_GENERATION === undefined) {
    throw new ConfigurationError('SQS_QUEUE_URL_GENERATION is required for generation worker polling');
  }

  const recoveryRunner = new PageGenerationWorkerRecoveryRunner();
  await recoveryRunner.run('startup');

  const poller = new GenerationQueuePoller(
    new SQSClient(env.AWS_REGION === undefined ? {} : { region: env.AWS_REGION }),
    resolveWorkerDependencies(),
    {
      queueUrl: env.SQS_QUEUE_URL_GENERATION,
      visibilityTimeoutSeconds: env.SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS,
    },
  );

  process.once('SIGINT', () => {
    console.info('[generation-worker] SIGINT received; stopping after current poll');
    poller.stop();
  });
  process.once('SIGTERM', () => {
    console.info('[generation-worker] SIGTERM received; stopping after current poll');
    poller.stop();
  });

  const recoveryTimer = setInterval(() => {
    void recoveryRunner.run('periodic');
  }, PAGE_GENERATION_RECOVERY_INTERVAL_MS);
  unrefTimer(recoveryTimer);

  try {
    console.info('[generation-worker] polling started');
    await poller.run();
  } finally {
    clearInterval(recoveryTimer);
    await closeDatabasePool();
    console.info('[generation-worker] polling stopped');
  }
}

class PageGenerationWorkerRecoveryRunner {
  private inFlight = false;

  public async run(reason: 'startup' | 'periodic'): Promise<void> {
    if (this.inFlight) {
      return;
    }

    this.inFlight = true;
    try {
      const recoveredCount = await new PageGenerationRecoveryService(
        new PostgresPageGenerationRecoveryRepository(db),
        new PostgresPageGenerationExecutionRepository(db),
        new CreditService(new PostgresCreditRepository(db, db)),
        PAGE_GENERATION_STALE_AFTER_MS,
        GENERATION_RECOVERY_BATCH_LIMIT,
      ).recoverAllStaleJobs();

      if (recoveredCount > 0) {
        console.warn(
          `[page-generation-recovery] worker ${reason} recovered ${recoveredCount} stale page generation job(s)`,
        );
      }
    } catch (error) {
      console.error(
        `[page-generation-recovery] worker ${reason} recovery failed`,
        sanitizePersistedErrorMessage(error, 'Page generation recovery failed'),
      );
    } finally {
      this.inFlight = false;
    }
  }
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    const unref = timer.unref;
    if (typeof unref === 'function') {
      unref.call(timer);
    }
  }
}

void main().catch(async (error: unknown) => {
  console.error(sanitizePersistedErrorMessage(error, 'Generation worker failed'));
  await closeDatabasePool();
  process.exitCode = 1;
});
