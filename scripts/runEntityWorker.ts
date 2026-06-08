import { handleGenerationQueue } from '../worker/index.js';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';

async function main(): Promise<void> {
  const jobId = process.argv[2];
  if (jobId === undefined) {
    throw new Error('Usage: npm run worker:entity -- <job-id>');
  }

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
}

main().catch((error: unknown) => {
  const message = sanitizePersistedErrorMessage(error, 'Unknown worker error');
  console.error(message);
  process.exitCode = 1;
});
