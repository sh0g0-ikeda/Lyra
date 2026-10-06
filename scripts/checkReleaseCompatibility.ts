import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  evaluateReleaseCompatibility,
  type ReleaseCompatibilityRuntime,
  type ReleaseProfile,
} from '../src/domain/release/ReleaseCompatibilityPolicy.js';
import type { DatabaseClient, TransactionRunner } from '../src/lib/db.js';
import type { Env } from '../src/lib/env.js';
import { checkDeploymentDataInvariants } from './checkDeploymentDataInvariants.js';

const CURRENT_SCHEMA_VERSION = 47;

export interface ReleaseCompatibilityCheckInput {
  profile: ReleaseProfile;
  mobileClientIds: readonly string[];
  runtime: ReleaseCompatibilityRuntime;
}

export interface ReleaseCompatibilityViolation {
  category: 'database' | 'generation' | 'state_recovery' | 'web_delivery';
  code: string;
  count: number;
}

export interface ReleaseCompatibilityReport {
  ok: boolean;
  profile: ReleaseProfile;
  checkedCount: number;
  journalPresent: boolean | null;
  remoteStoragePolicyVerified: false;
  violations: ReleaseCompatibilityViolation[];
}

export interface ReleaseCompatibilityCliArguments {
  profile: ReleaseProfile;
  mobileClientIds: string[];
}

export async function checkReleaseCompatibility(
  database: DatabaseClient & TransactionRunner,
  input: ReleaseCompatibilityCheckInput,
  options: { migrationsDir?: string } = {},
): Promise<ReleaseCompatibilityReport> {
  const expectedMigrations = await expectedMigrationFilenames(options.migrationsDir ?? join(process.cwd(), 'migrations'));
  return database.transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await client.query("SET LOCAL lock_timeout = '1s'");
    await client.query("SET LOCAL statement_timeout = '5s'");

    const history = await client.query<{ count: unknown }>(
      `WITH expected(filename) AS (SELECT unnest($1::text[])), differences AS (
         SELECT COALESCE(expected.filename, applied.filename) AS filename
         FROM expected FULL OUTER JOIN schema_migrations AS applied USING (filename)
         WHERE expected.filename IS NULL OR applied.filename IS NULL
       ) SELECT COUNT(*)::int AS count FROM differences`,
      [expectedMigrations],
    );
    const historyDifferenceCount = readNonNegativeSafeInteger(history.rows);
    if (historyDifferenceCount > 0) {
      return buildReport(input.profile, 1, null, [{
        category: 'database', code: 'SCHEMA_HISTORY_MISMATCH', count: historyDifferenceCount,
      }]);
    }

    const journal = await client.query<{ present: unknown }>(
      'SELECT EXISTS (SELECT 1 FROM state_reference_copy_attempts) AS present',
    );
    const journalPresent = readBoolean(journal.rows);
    const invariantReport = await checkDeploymentDataInvariants(client);
    const policyReport = evaluateReleaseCompatibility({
      profile: input.profile,
      journalPresent,
      mobileClientIds: input.mobileClientIds,
      runtime: input.runtime,
    });
    const violations: ReleaseCompatibilityViolation[] = [
      ...invariantReport.violations.map((violation) => ({
        category: 'database' as const,
        code: `DATA_INVARIANT:${violation.name}`,
        count: violation.sampleIds.length,
      })),
      ...policyReport.violations.map((violation) => ({ ...violation, count: 1 })),
    ];
    return buildReport(input.profile, 2 + invariantReport.checkedCount + policyReport.checkedCount, journalPresent, violations);
  });
}

export function parseReleaseCompatibilityArgs(args: readonly string[]): ReleaseCompatibilityCliArguments {
  let profile: ReleaseProfile | undefined;
  const mobileClientIds: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--profile') {
      if (value !== 'backend-only' && value !== 'new-mobile') throw new Error('A valid release profile is required');
      profile = value;
      index += 1;
      continue;
    }
    if (argument === '--mobile-client-id') {
      if (value === undefined || value.trim().length === 0 || value.startsWith('--')) {
        throw new Error('A valid release argument is required');
      }
      mobileClientIds.push(value.trim());
      index += 1;
      continue;
    }
    throw new Error('An unknown release argument was provided');
  }
  if (profile === undefined) throw new Error('A release profile is required');
  return { profile, mobileClientIds: Array.from(new Set(mobileClientIds)) };
}

export function runtimeFromEnv(environment: Env): ReleaseCompatibilityRuntime {
  return {
    generationQuotesEnabled: environment.GENERATION_QUOTES_ENABLED,
    generationEnabled: environment.GENERATION_ENABLED,
    pageGenerationEnabled: environment.PAGE_GENERATION_ENABLED,
    entityGenerationEnabled: environment.ENTITY_GENERATION_ENABLED,
    entityImportAnalysisEnabled: environment.ENTITY_IMPORT_ANALYSIS_ENABLED,
    entityReferenceDirectUploadEnabled: environment.ENTITY_REFERENCE_DIRECT_UPLOAD_ENABLED,
    openAiApiKeyConfigured: environment.OPENAI_API_KEY !== undefined,
    openAiImageModel: environment.OPENAI_IMAGE_MODEL,
    generationQueueConfigured: environment.SQS_QUEUE_URL_GENERATION !== undefined,
    imageStorageConfigured: environment.S3_BUCKET_IMAGES !== undefined,
    awsRegionConfigured: environment.AWS_REGION !== undefined,
    localImageFallbackEnabled: environment.LOCAL_IMAGE_FALLBACK_ENABLED,
    webImageDeliveryClientIds: splitList(environment.WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS),
    stateReferenceCopyV2AdmissionEnabled: environment.STATE_REFERENCE_COPY_V2_ADMISSION_ENABLED,
    stateReferenceCopyV2StorageContractAttested: environment.STATE_REFERENCE_COPY_V2_STORAGE_CONTRACT_ATTESTED,
    stateReferenceCopyV2ImageRoleArn: environment.STATE_REFERENCE_COPY_V2_IMAGE_ROLE_ARN,
    stateReferenceCopyV2RecoveryRoleArn: environment.STATE_REFERENCE_COPY_V2_RECOVERY_ROLE_ARN,
    stateReferenceCopyV2ExpectedBucketOwner: environment.STATE_REFERENCE_COPY_V2_EXPECTED_BUCKET_OWNER,
    stateReferenceCopyV2VersioningHistory: environment.STATE_REFERENCE_COPY_V2_VERSIONING_HISTORY,
    stateReferenceCopyV2BucketName: environment.S3_BUCKET_IMAGES,
    stateReferenceCopyV2Region: environment.AWS_REGION,
  };
}

async function expectedMigrationFilenames(migrationsDir: string): Promise<string[]> {
  const filenames = (await readdir(migrationsDir)).filter((filename) => /^\d{3}_.+\.sql$/u.test(filename)).sort();
  if (filenames.length !== CURRENT_SCHEMA_VERSION
    || filenames.some((filename, index) => Number(filename.slice(0, 3)) !== index + 1)) {
    throw new Error('Current release migration files are unavailable');
  }
  return filenames;
}

function splitList(value: string): string[] {
  return Array.from(new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean)));
}

function readNonNegativeSafeInteger(rows: readonly { count: unknown }[]): number {
  if (rows.length !== 1) throw invalidDatabaseResult();
  const value = rows[0]?.count;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^(0|[1-9]\d*)$/u.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw invalidDatabaseResult();
  return parsed;
}

function readBoolean(rows: readonly { present: unknown }[]): boolean {
  if (rows.length !== 1 || typeof rows[0]?.present !== 'boolean') throw invalidDatabaseResult();
  return rows[0].present;
}

function invalidDatabaseResult(): Error {
  return new Error('Release compatibility database result is invalid');
}

function buildReport(
  profile: ReleaseProfile,
  checkedCount: number,
  journalPresent: boolean | null,
  violations: ReleaseCompatibilityViolation[],
): ReleaseCompatibilityReport {
  return { ok: violations.length === 0, profile, checkedCount, journalPresent, remoteStoragePolicyVerified: false, violations };
}

async function main(): Promise<void> {
  const args = parseReleaseCompatibilityArgs(process.argv.slice(2));
  const { loadRuntimeSecretEnv } = await import('../src/lib/runtimeSecretEnv.js');
  await loadRuntimeSecretEnv();
  const { env } = await import('../src/lib/env.js');
  const { assertProductionRuntimeConfig } = await import('../src/lib/runtimeGuards.js');
  const { closeDatabasePool, db } = await import('../src/lib/db.js');
  try {
    assertProductionRuntimeConfig(env);
    const result = await checkReleaseCompatibility(db, { ...args, runtime: runtimeFromEnv(env) });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Release compatibility check failed; no database or configuration details are emitted.');
    process.exitCode = 1;
  });
}
