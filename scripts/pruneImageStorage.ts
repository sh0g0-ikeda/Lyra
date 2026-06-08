import { pathToFileURL } from 'node:url';

export interface PruneImageStorageCliOptions {
  prefixes: string[];
  olderThanHours: number;
  protectRecentCandidateHours: number;
  maxDeletes: number;
  apply: boolean;
}

export function parsePruneImageStorageArgs(argv: readonly string[]): PruneImageStorageCliOptions {
  const prefixes: string[] = [];
  const values = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--dry-run') {
      values.set(arg, true);
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === '--prefix') {
      prefixes.push(value);
    } else {
      values.set(arg, value);
    }
    index += 1;
  }

  return {
    prefixes: prefixes.length === 0 ? ['tmp/', 'session/'] : Array.from(new Set(prefixes)),
    olderThanHours: readPositiveInteger(values, '--older-than-hours', 24),
    protectRecentCandidateHours: readPositiveInteger(values, '--protect-recent-candidate-hours', 48),
    maxDeletes: readPositiveInteger(values, '--max-deletes', 500),
    apply: values.get('--apply') === true && values.get('--dry-run') !== true,
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
      dryRun: !options.apply,
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

function readPositiveInteger(values: Map<string, string | boolean>, key: string, defaultValue: number): number {
  const rawValue = values.get(key);
  if (rawValue === undefined) {
    return defaultValue;
  }

  if (typeof rawValue !== 'string') {
    throw new Error(`${key} must be a positive integer`);
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
}

function printUsage(): void {
  console.error([
    'Usage:',
    '  npm run admin:prune-images -- [--prefix tmp/] [--prefix session/] [--older-than-hours 24] [--protect-recent-candidate-hours 48] [--max-deletes 500] [--apply]',
    '',
    'Default mode is dry-run. The script only accepts tmp/ and session/ prefixes; saved/ is intentionally excluded.',
  ].join('\n'));
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Unknown image pruning error');
    printUsage();
    process.exitCode = 1;
  });
}
