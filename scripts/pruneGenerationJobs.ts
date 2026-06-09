import { pathToFileURL } from 'node:url';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';

export interface PruneGenerationJobsCliOptions {
  maxDeletes: number;
  apply: boolean;
}

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const PRUNE_JOB_FLAG_OPTIONS = new Set(['--apply', '--dry-run']);
const PRUNE_JOB_VALUE_OPTIONS = new Set(['--max-deletes']);
const MAX_PRUNE_GENERATION_JOB_DELETES = 10_000;

export function parsePruneGenerationJobsArgs(argv: readonly string[]): PruneGenerationJobsCliOptions {
  const values = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (PRUNE_JOB_FLAG_OPTIONS.has(arg)) {
      values.set(arg, true);
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    if (!PRUNE_JOB_VALUE_OPTIONS.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (values.has(arg)) {
      throw new Error(`Duplicate option: ${arg}`);
    }
    values.set(arg, value);
    index += 1;
  }

  return {
    maxDeletes: readPositiveInteger(
      values,
      '--max-deletes',
      500,
      MAX_PRUNE_GENERATION_JOB_DELETES,
    ),
    apply: values.get('--apply') === true && values.get('--dry-run') !== true,
  };
}

async function main(): Promise<void> {
  const options = parsePruneGenerationJobsArgs(process.argv.slice(2));
  const [{ closeDatabasePool, db }, { PostgresGenerationJobRepository }] = await Promise.all([
    import('../src/lib/db.js'),
    import('../src/repositories/GenerationJobRepository.js'),
  ]);

  try {
    const repository = new PostgresGenerationJobRepository(db);
    const result = await repository.pruneExpiredTerminalJobs({
      maxDeletes: options.maxDeletes,
      dryRun: !options.apply,
    });

    console.log(JSON.stringify({
      ...result,
      message: result.dryRun
        ? 'Dry-run only. Re-run with --apply to delete listed expired terminal jobs.'
        : 'Expired terminal generation job pruning completed.',
    }, null, 2));
  } finally {
    await closeDatabasePool();
  }
}

function readPositiveInteger(
  values: Map<string, string | boolean>,
  key: string,
  defaultValue: number,
  maxValue: number,
): number {
  const rawValue = values.get(key);
  if (rawValue === undefined) {
    return defaultValue;
  }

  if (typeof rawValue !== 'string') {
    throw new Error(`${key} must be a positive integer`);
  }

  const trimmedValue = rawValue.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(trimmedValue)) {
    throw new Error(`${key} must be a positive integer`);
  }

  const value = Number(trimmedValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  if (value > maxValue) {
    throw new Error(`${key} must be ${maxValue} or less`);
  }

  return value;
}

function printUsage(): void {
  console.error([
    'Usage:',
    '  bun run admin:prune-jobs -- [--max-deletes 500] [--apply]',
    '',
    'Default mode is dry-run. Only completed or failed generation jobs past expires_at are deleted.',
  ].join('\n'));
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(sanitizePersistedErrorMessage(error, 'Unknown generation job pruning error'));
    printUsage();
    process.exitCode = 1;
  });
}
