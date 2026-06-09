import { pathToFileURL } from 'node:url';
import type { DatabaseClient } from '../src/lib/db.js';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';

export interface AdminRefundCreditsOptions {
  userId: string;
  amount: number;
  reason: string;
  jobId?: string;
  apply: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const ADMIN_REFUND_FLAG_OPTIONS = new Set(['--apply', '--dry-run']);
const ADMIN_REFUND_VALUE_OPTIONS = new Set(['--user-id', '--amount', '--reason', '--job-id']);
const DEFAULT_REASON = 'Manual admin credit refund';
const MAX_ADMIN_REFUND_CREDITS = 10_000;

export function parseAdminRefundCreditsArgs(argv: readonly string[]): AdminRefundCreditsOptions {
  const args = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (ADMIN_REFUND_FLAG_OPTIONS.has(arg)) {
      args.set(arg, true);
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    if (!ADMIN_REFUND_VALUE_OPTIONS.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (args.has(arg)) {
      throw new Error(`Duplicate option: ${arg}`);
    }

    args.set(arg, value);
    index += 1;
  }

  const userId = readRequiredString(args, '--user-id');
  const amount = readPositiveInteger(args, '--amount');
  const reason = readOptionalString(args, '--reason') ?? DEFAULT_REASON;
  const jobId = readOptionalString(args, '--job-id');

  if (!UUID_PATTERN.test(userId)) {
    throw new Error('--user-id must be a UUID');
  }

  if (jobId !== undefined && !UUID_PATTERN.test(jobId)) {
    throw new Error('--job-id must be a UUID');
  }

  if (args.get('--apply') === true && args.get('--dry-run') !== true && jobId === undefined) {
    throw new Error('--job-id is required when --apply is used');
  }

  if (reason.length > 500) {
    throw new Error('--reason must be 500 characters or shorter');
  }

  return {
    userId,
    amount,
    reason,
    ...(jobId === undefined ? {} : { jobId }),
    apply: args.get('--apply') === true && args.get('--dry-run') !== true,
  };
}

async function main(): Promise<void> {
  const options = parseAdminRefundCreditsArgs(process.argv.slice(2));
  const [
    { closeDatabasePool, db },
    { PostgresCreditRepository },
    { CreditService },
  ] = await Promise.all([
    import('../src/lib/db.js'),
    import('../src/repositories/CreditRepository.js'),
    import('../src/services/credit/CreditService.js'),
  ]);

  try {
    const user = await findUser(db, options.userId);

    if (user === null) {
      throw new Error(`User not found: ${options.userId}`);
    }

    if (!options.apply) {
      console.log(JSON.stringify({
        dry_run: true,
        user,
        amount: options.amount,
        reason: options.reason,
        job_id: options.jobId ?? null,
        message: 'No credits were changed. Re-run with --apply to execute.',
      }, null, 2));
      return;
    }

    const creditService = new CreditService(new PostgresCreditRepository(db, db));
    const balance = await creditService.refundCredits({
      userId: options.userId,
      amount: options.amount,
      description: options.reason,
      jobId: options.jobId,
    });

    console.log(JSON.stringify({
      dry_run: false,
      user,
      amount: options.amount,
      reason: options.reason,
      job_id: options.jobId ?? null,
      balance,
    }, null, 2));
  } finally {
    await closeDatabasePool();
  }
}

async function findUser(
  database: DatabaseClient,
  userId: string,
): Promise<{ id: string; email: string } | null> {
  const result = await database.query<{ id: string; email: string }>(
    `
    SELECT id, email
    FROM users
    WHERE id = $1
    `,
    [userId],
  );

  return result.rows[0] ?? null;
}

function readRequiredString(args: Map<string, string | boolean>, key: string): string {
  const value = readOptionalString(args, key);
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function readOptionalString(args: Map<string, string | boolean>, key: string): string | undefined {
  const value = args.get(key);
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

function readPositiveInteger(args: Map<string, string | boolean>, key: string): number {
  const rawValue = readRequiredString(args, key);
  if (!POSITIVE_INTEGER_PATTERN.test(rawValue)) {
    throw new Error(`${key} must be a positive integer`);
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  if (key === '--amount' && value > MAX_ADMIN_REFUND_CREDITS) {
    throw new Error(`${key} must be ${MAX_ADMIN_REFUND_CREDITS} or less`);
  }

  return value;
}

function printUsage(): void {
  console.error([
    'Usage:',
    '  bun run admin:refund-credits -- --user-id <uuid> --amount <credits> [--reason <text>] --job-id <uuid> --apply',
    '  bun run admin:refund-credits -- --user-id <uuid> --amount <credits> [--reason <text>] [--job-id <uuid>] [--dry-run]',
    '',
    'Default mode is dry-run. Apply mode requires --job-id so refunds stay capped and idempotent.',
  ].join('\n'));
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(sanitizePersistedErrorMessage(error, 'Unknown admin credit refund error'));
    printUsage();
    process.exitCode = 1;
  });
}
