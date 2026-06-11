import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigurationError } from '../src/domain/errors/index.js';
import { env } from '../src/lib/env.js';
import { closeDatabasePool } from '../src/lib/db.js';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import { resolveWorkerDependencies } from '../worker/dependencies.js';
import { GenerationQueuePoller } from '../worker/sqsPoller.js';

async function main(): Promise<void> {
  if (env.SQS_QUEUE_URL_GENERATION === undefined) {
    throw new ConfigurationError('SQS_QUEUE_URL_GENERATION is required for generation worker polling');
  }

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

  try {
    console.info('[generation-worker] polling started');
    await poller.run();
  } finally {
    await closeDatabasePool();
    console.info('[generation-worker] polling stopped');
  }
}

void main().catch(async (error: unknown) => {
  console.error(sanitizePersistedErrorMessage(error, 'Generation worker failed'));
  await closeDatabasePool();
  process.exitCode = 1;
});
