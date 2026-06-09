import { pathToFileURL } from 'node:url';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';

export interface PruneImageStorageCliOptions {
  prefixes: string[];
  olderThanHours: number;
  protectRecentCandidateHours: number;
  maxDeletes: number;
  maxScanned: number;
  apply: boolean;
  includeSavedUnreferenced: boolean;
  confirmSavedPruning: boolean;
}

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const PRUNE_FLAG_OPTIONS = new Set([
  '--apply',
  '--dry-run',
  '--include-saved-unreferenced',
  '--confirm-saved-pruning',
]);
const PRUNE_VALUE_OPTIONS = new Set([
  '--prefix',
  '--older-than-hours',
  '--protect-recent-candidate-hours',
  '--max-deletes',
  '--max-scanned',
]);
const MAX_PRUNE_IMAGE_DELETES = 10_000;
const MAX_PRUNE_IMAGE_SCANNED = 100_000;

export function parsePruneImageStorageArgs(argv: readonly string[]): PruneImageStorageCliOptions {
  const prefixes: string[] = [];
  const values = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (PRUNE_FLAG_OPTIONS.has(arg)) {
      values.set(arg, true);
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    if (!PRUNE_VALUE_OPTIONS.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === '--prefix') {
      prefixes.push(value);
    } else {
      if (values.has(arg)) {
        throw new Error(`Duplicate option: ${arg}`);
      }
      values.set(arg, value);
    }
    index += 1;
  }

  const apply = values.get('--apply') === true && values.get('--dry-run') !== true;
  const includeSavedUnreferenced = values.get('--include-saved-unreferenced') === true;
  const confirmSavedPruning = values.get('--confirm-saved-pruning') === true;

  if (apply && includeSavedUnreferenced && !confirmSavedPruning) {
    throw new Error('--confirm-saved-pruning is required when applying saved image pruning');
  }

  return {
    prefixes: prefixes.length === 0 ? ['tmp/', 'session/'] : Array.from(new Set(prefixes)),
    olderThanHours: readPositiveInteger(values, '--older-than-hours', 24),
    protectRecentCandidateHours: readPositiveInteger(values, '--protect-recent-candidate-hours', 48),
    maxDeletes: readPositiveInteger(values, '--max-deletes', 500, MAX_PRUNE_IMAGE_DELETES),
    maxScanned: readPositiveInteger(values, '--max-scanned', 5000, MAX_PRUNE_IMAGE_SCANNED),
    apply,
    includeSavedUnreferenced,
    confirmSavedPruning,
  };
}

async function main(): Promise<void> {
  const options = parsePruneImageStorageArgs(process.argv.slice(2));
  const [
    { createImageStorageMaintenanceClient, S3ImageStorageMaintenance },
    { closeDatabasePool, db },
    { env },
    { PostgresImageStorageReferenceRepository },
    { ImageStoragePruningService },
  ] = await Promise.all([
    import('../src/infrastructure/aws/S3ImageStorageMaintenance.js'),
    import('../src/lib/db.js'),
    import('../src/lib/env.js'),
    import('../src/repositories/ImageStorageReferenceRepository.js'),
    import('../src/services/storage/ImageStoragePruningService.js'),
  ]);

  try {
    if (env.S3_BUCKET_IMAGES === undefined) {
      throw new Error('S3_BUCKET_IMAGES is required');
    }

    const service = new ImageStoragePruningService(
      new S3ImageStorageMaintenance(
        createImageStorageMaintenanceClient(env.AWS_REGION),
        env.S3_BUCKET_IMAGES,
      ),
      new PostgresImageStorageReferenceRepository(db),
    );

    const result = await service.prune({
      prefixes: options.prefixes,
      olderThanHours: options.olderThanHours,
      protectRecentCandidateHours: options.protectRecentCandidateHours,
      maxDeletes: options.maxDeletes,
      maxScanned: options.maxScanned,
      dryRun: !options.apply,
      includeSavedUnreferenced: options.includeSavedUnreferenced,
    });

    console.log(JSON.stringify({
      ...result,
      message: result.dryRun
        ? 'Dry-run only. Re-run with --apply to delete listed candidates.'
        : 'Pruning completed.',
    }, null, 2));
  } finally {
    await closeDatabasePool();
  }
}

function readPositiveInteger(
  values: Map<string, string | boolean>,
  key: string,
  defaultValue: number,
  maxValue?: number,
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
  if (maxValue !== undefined && value > maxValue) {
    throw new Error(`${key} must be ${maxValue} or less`);
  }

  return value;
}

function printUsage(): void {
  console.error([
    'Usage:',
    '  bun run admin:prune-images -- [--prefix tmp/] [--prefix session/] [--prefix saved/] [--older-than-hours 24] [--protect-recent-candidate-hours 48] [--max-deletes 500] [--max-scanned 5000] [--include-saved-unreferenced] [--confirm-saved-pruning] [--apply]',
    '',
    'Default mode is dry-run. saved/ prefixes are accepted only with --include-saved-unreferenced and apply mode also requires --confirm-saved-pruning. Live DB references remain protected.',
  ].join('\n'));
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(sanitizePersistedErrorMessage(error, 'Unknown image pruning error'));
    printUsage();
    process.exitCode = 1;
  });
}
