import { pathToFileURL } from 'node:url';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import {
  MAX_STRIPE_RECOVERY_BACKFILL_CREDITS,
  StripeRecoveryBackfillService,
  type StripeRecoveryBackfillInput,
} from '../src/services/billing/StripeRecoveryBackfillService.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const FLAG_OPTIONS = new Set(['--apply', '--dry-run']);
const VALUE_OPTIONS = new Set(['--unresolved-id', '--credits', '--expires-at']);

export function parseStripeRecoveryBackfillArgs(argv: readonly string[]): StripeRecoveryBackfillInput {
  const args = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (FLAG_OPTIONS.has(option)) {
      if (args.has(option)) throw new Error(`Duplicate option: ${option}`);
      args.set(option, true);
      continue;
    }
    if (!option.startsWith('--')) throw new Error(`Unexpected argument: ${option}`);
    if (!VALUE_OPTIONS.has(option)) throw new Error(`Unknown option: ${option}`);
    if (args.has(option)) throw new Error(`Duplicate option: ${option}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    args.set(option, value.trim());
    index += 1;
  }

  if (args.get('--apply') === true && args.get('--dry-run') === true) {
    throw new Error('--apply and --dry-run cannot be used together');
  }
  const unresolvedAdjustmentId = required(args, '--unresolved-id');
  if (!UUID_PATTERN.test(unresolvedAdjustmentId)) {
    throw new Error('--unresolved-id must be a UUID');
  }
  const creditsRaw = required(args, '--credits');
  if (!POSITIVE_INTEGER_PATTERN.test(creditsRaw)) {
    throw new Error('--credits must be a positive integer');
  }
  const grantedCredits = Number(creditsRaw);
  if (
    !Number.isSafeInteger(grantedCredits)
    || grantedCredits <= 0
    || grantedCredits > MAX_STRIPE_RECOVERY_BACKFILL_CREDITS
  ) {
    throw new Error(`--credits must be between 1 and ${MAX_STRIPE_RECOVERY_BACKFILL_CREDITS}`);
  }
  const expiresAtRaw = required(args, '--expires-at');
  if (!ISO_TIMESTAMP_PATTERN.test(expiresAtRaw)) {
    throw new Error('--expires-at must be a complete ISO-8601 timestamp with a timezone');
  }
  const grantExpiresAt = new Date(expiresAtRaw);
  if (!Number.isFinite(grantExpiresAt.getTime())) {
    throw new Error('--expires-at must be a valid timestamp');
  }
  return {
    unresolvedAdjustmentId,
    grantedCredits,
    grantExpiresAt,
    apply: args.get('--apply') === true,
  };
}

async function main(): Promise<void> {
  const input = parseStripeRecoveryBackfillArgs(process.argv.slice(2));
  const [
    { closeDatabasePool, db },
    { assertCreditRecoverySchema },
    { PostgresStripeRecoveryBackfillRepository },
  ] = await Promise.all([
    import('../src/lib/db.js'),
    import('../src/lib/creditRecoverySchemaGuard.js'),
    import('../src/repositories/StripeRecoveryBackfillRepository.js'),
  ]);
  try {
    await assertCreditRecoverySchema(db);
    const result = await new StripeRecoveryBackfillService(
      new PostgresStripeRecoveryBackfillRepository(db),
    ).backfill(input);
    console.log(JSON.stringify({
      unresolved_adjustment_id: result.unresolvedAdjustmentId,
      dry_run: result.dryRun,
      action: result.action,
      granted_credits: result.grantedCredits,
      grant_expires_at: result.grantExpiresAt.toISOString(),
      next_step: 'Replay the original signed Stripe event through the normal webhook path.',
    }, null, 2));
  } finally {
    await closeDatabasePool();
  }
}

function required(args: ReadonlyMap<string, string | boolean>, key: string): string {
  const value = args.get(key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function printUsage(): void {
  console.error([
    'Usage:',
    '  node --import tsx scripts/backfillStripeSubscriptionRecovery.ts --unresolved-id <uuid> --credits <positive-int> --expires-at <ISO timestamp> [--dry-run]',
    '  node --import tsx scripts/backfillStripeSubscriptionRecovery.ts --unresolved-id <uuid> --credits <positive-int> --expires-at <ISO timestamp> --apply',
    '',
    'Default mode is read-only dry-run. Apply only records verified grant metadata and recovery linkage.',
    'The command never changes credit balances, ledger rows, hold state, or Stripe processed-event markers.',
  ].join('\n'));
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(sanitizePersistedErrorMessage(error, 'Stripe recovery backfill failed'));
    printUsage();
    process.exitCode = 1;
  });
}
