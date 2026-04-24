import { db } from '../src/lib/db.js';
import { PostgresGenerationJobRepository } from '../src/repositories/GenerationJobRepository.js';
import { PageGenerationRetryService } from '../src/services/page/PageGenerationRetryService.js';
import { resolveWorkerDependencies } from '../worker/dependencies.js';

async function main(): Promise<void> {
  const jobId = process.argv[2];
  if (jobId === undefined) {
    throw new Error('Usage: npm run worker:retry -- <job-id>');
  }

  const retryService = new PageGenerationRetryService(
    new PostgresGenerationJobRepository(db),
    resolveWorkerDependencies().pageGenerationWorkerService,
  );

  await retryService.retryFailedJob(jobId);
  console.info(`Retried page generation job ${jobId}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unknown retry error');
  process.exitCode = 1;
});
