import { pathToFileURL } from 'node:url';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import { parseRetryPageGenerationArgs } from './workerCliArgs.js';

async function main(): Promise<void> {
  const { jobId, userId } = parseRetryPageGenerationArgs(process.argv.slice(2));
  const [
    { closeDatabasePool, db },
    { PostgresCreditRepository },
    { PostgresGenerationJobRepository },
    { CreditService },
    { PageGenerationRetryService },
    { resolveWorkerDependencies },
  ] = await Promise.all([
    import('../src/lib/db.js'),
    import('../src/repositories/CreditRepository.js'),
    import('../src/repositories/GenerationJobRepository.js'),
    import('../src/services/credit/CreditService.js'),
    import('../src/services/page/PageGenerationRetryService.js'),
    import('../worker/dependencies.js'),
  ]);

  try {
    const retryService = new PageGenerationRetryService(
      new PostgresGenerationJobRepository(db),
      resolveWorkerDependencies().pageGenerationWorkerService,
      new CreditService(new PostgresCreditRepository(db, db)),
    );

    await retryService.retryFailedJob(userId, jobId);
    console.info(`Retried page generation job ${jobId} for user ${userId}`);
  } finally {
    await closeDatabasePool();
  }
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void main().catch((error) => {
    console.error(sanitizePersistedErrorMessage(error, 'Unknown retry error'));
    process.exitCode = 1;
  });
}
