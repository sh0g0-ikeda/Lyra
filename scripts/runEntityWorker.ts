import { pathToFileURL } from 'node:url';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import { parseManualWorkerArgs } from './workerCliArgs.js';

async function main(): Promise<void> {
  const { jobId } = parseManualWorkerArgs(process.argv.slice(2), 'worker:entity');
  const { closeDatabasePool } = await import('../src/lib/db.js');

  try {
    const { handleGenerationQueue } = await import('../worker/index.js');
    const result = await handleGenerationQueue({
      Records: [
        {
          messageId: `manual-${jobId}`,
          body: JSON.stringify({
            job_id: jobId,
            job_type: 'entity_generate',
          }),
        },
      ],
    });

    console.log(JSON.stringify(result, null, 2));
    if (result.failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await closeDatabasePool();
  }
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    const message = sanitizePersistedErrorMessage(error, 'Unknown worker error');
    console.error(message);
    process.exitCode = 1;
  });
}
