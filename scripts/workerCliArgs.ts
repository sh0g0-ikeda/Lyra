export interface ManualWorkerCliOptions {
  jobId: string;
}

export interface RetryPageGenerationCliOptions {
  jobId: string;
  userId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseManualWorkerArgs(
  argv: readonly string[],
  commandName: string,
): ManualWorkerCliOptions {
  if (argv.length !== 1) {
    throw new Error(`Usage: npm run ${commandName} -- <job-id>`);
  }

  const jobId = argv[0];
  if (!UUID_PATTERN.test(jobId)) {
    throw new Error('<job-id> must be a UUID');
  }

  return { jobId };
}

export function parseRetryPageGenerationArgs(
  argv: readonly string[],
): RetryPageGenerationCliOptions {
  if (argv.length !== 2) {
    throw new Error('Usage: npm run worker:retry -- <job-id> <user-id>');
  }

  const [jobId, userId] = argv;
  if (!UUID_PATTERN.test(jobId)) {
    throw new Error('<job-id> must be a UUID');
  }

  if (!UUID_PATTERN.test(userId)) {
    throw new Error('<user-id> must be a UUID');
  }

  return { jobId, userId };
}
