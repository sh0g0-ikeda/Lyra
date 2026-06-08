import { db } from '../src/lib/db.js';
import { PostgresCreditRepository } from '../src/repositories/CreditRepository.js';
import { PostgresGenerationJobRepository } from '../src/repositories/GenerationJobRepository.js';
import { CreditService } from '../src/services/credit/CreditService.js';
import { PageGenerationRetryService } from '../src/services/page/PageGenerationRetryService.js';
import { resolveWorkerDependencies } from '../worker/dependencies.js';

async function main(): Promise<void> {
  const jobId = process.argv[2];
  const userId = process.argv[3];
  if (jobId === undefined || userId === undefined) {
    throw new Error('Usage: npm run worker:retry -- <job-id> <user-id>');
  }

  const retryService = new PageGenerationRetryService(
    new PostgresGenerationJobRepository(db),
    resolveWorkerDependencies().pageGenerationWorkerService,
    new CreditService(new PostgresCreditRepository(db, db)),
  );

  await retryService.retryFailedJob(userId, jobId);
  console.info(`Retried page generation job ${jobId} for user ${userId}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unknown retry error');
  process.exitCode = 1;
});
