import { pathToFileURL } from 'node:url';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';

export interface PruneRateLimitBucketsCliOptions {
  olderThanHours: number;
  maxDeletes: number;
  apply: boolean;
}

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const PRUNE_RATE_LIMIT_FLAG_OPTIONS = new Set(['--apply', '--dry-run']);
const PRUNE_RATE_LIMIT_VALUE_OPTIONS = new Set(['--older-than-hours', '--max-deletes']);
const MAX_PRUNE_RATE_LIMIT_OLDER_THAN_HOURS = 8_760;
const MAX_PRUNE_RATE_LIMIT_DELETES = 10_000;

export function parsePruneRateLimitBucketsArgs(argv: readonly string[]): PruneRateLimitBucketsCliOptions {
  const values = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (PRUNE_RATE_LIMIT_FLAG_OPTIONS.has(arg)) {
      values.set(arg, true);
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    if (!PRUNE_RATE_LIMIT_VALUE_OPTIONS.has(arg)) {
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
    olderThanHours: readPositiveInteger(
      values,
      '--older-than-hours',
      24,
      MAX_PRUNE_RATE_LIMIT_OLDER_THAN_HOURS,
    ),
    maxDeletes: readPositiveInteger(
      values,
      '--max-deletes',
      1_000,
      MAX_PRUNE_RATE_LIMIT_DELETES,
    ),
    apply: values.get('--apply') === true && values.get('--dry-run') !== true,
  };
}

async function main(): Promise<void> {
  const options = parsePruneRateLimitBucketsArgs(process.argv.slice(2));
  const [{ closeDatabasePool, db }, { PostgresRateLimitStore }] = await Promise.all([
    import('../src/lib/db.js'),
    import('../src/repositories/RateLimitStore.js'),
  ]);

  try {
    const repository = new PostgresRateLimitStore(db);
    const result = await repository.pruneExpiredBuckets({
      olderThanHours: options.olderThanHours,
      maxDeletes: options.maxDeletes,
      dryRun: !options.apply,
    });

    console.log(JSON.stringify({
      ...result,
      message: result.dryRun
        ? 'Dry-run only. Re-run with --apply to delete listed expired rate limit buckets.'
        : 'Expired rate limit bucket pruning completed.',
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
    '  bun run admin:prune-rate-limits -- [--older-than-hours 24] [--max-deletes 1000] [--apply]',
    '',
    'Default mode is dry-run. Only rate limit buckets expired before the retention window are deleted.',
  ].join('\n'));
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(sanitizePersistedErrorMessage(error, 'Unknown rate limit bucket pruning error'));
    printUsage();
    process.exitCode = 1;
  });
}
