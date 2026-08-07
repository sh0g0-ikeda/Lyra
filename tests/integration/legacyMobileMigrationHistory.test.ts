import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Client,
  type QueryResult,
  type QueryResultRow,
} from 'pg';
import { describe, expect, it } from 'vitest';
import { checkDeploymentDataInvariants } from '../../scripts/checkDeploymentDataInvariants.js';
import {
  runPendingMigrations,
  type MigrationRunnerPort,
} from '../../src/lib/migrations.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest =
  process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

const CONTENT_EQUIVALENT_LEGACY_MIGRATIONS = [
  ['024_add_account_deletion_requests.sql', '027_add_account_deletion_requests.sql'],
  ['025_add_page_story_metadata_columns.sql', '028_add_page_story_metadata_columns.sql'],
  ['026_add_mobile_store_purchase_ledger.sql', '029_add_mobile_store_purchase_ledger.sql'],
  ['028_add_entity_reference_upload_tokens.sql', '031_add_entity_reference_upload_tokens.sql'],
  ['029_add_episode_export_jobs.sql', '032_add_episode_export_jobs.sql'],
  ['030_add_mobile_push_token_registry.sql', '033_add_mobile_push_token_registry.sql'],
  ['031_add_mobile_push_notification_outbox.sql', '034_add_mobile_push_notification_outbox.sql'],
] as const;

describePostgres('legacy Mobile migration history reconciliation', () => {
  it('旧024から032だけを適用したDBを現行040までforward更新する', async () => {
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL is required for the PostgreSQL migration test');
    }

    const adminUrl = new URL(databaseUrl);
    const databaseName = `lyra_legacy_mobile_${process.pid}_${Date.now()}`;
    const targetUrl = new URL(databaseUrl);
    targetUrl.pathname = `/${databaseName}`;
    const admin = new Client({ connectionString: adminUrl.toString() });
    const legacyMigrationsDirectory = await mkdtemp(
      join(tmpdir(), 'lyra-legacy-mobile-migrations-'),
    );

    await admin.connect();
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

    try {
      const target = new Client({ connectionString: targetUrl.toString() });
      await target.connect();

      try {
        await prepareLegacyMigrationDirectory(legacyMigrationsDirectory);
        const runner = new ClientMigrationRunner(target);
        const legacyApplied = await runPendingMigrations(runner, {
          migrationsDir: legacyMigrationsDirectory,
          migrationLockMaxAttempts: 1,
          migrationLockPollMs: 0,
        });
        expect(legacyApplied).toHaveLength(32);
        expect(legacyApplied.at(-1)).toBe(
          '032_add_processing_generation_job_cancellation.sql',
        );

        const userId = '10000000-0000-4000-8000-000000000010';
        const jobId = '30000000-0000-4000-8000-000000000010';
        await target.query(
          `INSERT INTO users (id, supabase_id, email)
           VALUES ($1, 'legacy-mobile-user', 'legacy-mobile@example.com')`,
          [userId],
        );
        await target.query(
          `INSERT INTO generation_jobs (
             id, user_id, job_type, status, credit_cost, params,
             cancel_requested_at, cancel_requested_by_user_id
           )
           VALUES (
             $1, $2, 'page_generate', 'canceled', 0, '{}'::JSONB,
             NOW(), $2
           )`,
          [jobId, userId],
        );

        const applied = await runPendingMigrations(runner, {
          migrationsDir: join(process.cwd(), 'migrations'),
          migrationLockMaxAttempts: 1,
          migrationLockPollMs: 0,
        });
        expect(applied).toEqual([
          '025_include_cancelled_jobs_in_retention_index.sql',
          '026_backfill_legacy_credit_consume_job_links.sql',
          '030_add_generation_job_management.sql',
          '035_add_processing_generation_job_cancellation.sql',
          '036_fix_push_notification_cancelled_guard.sql',
          '040_repair_page_story_metadata_columns.sql',
        ]);

        const repairedJob = await target.query<{
          status: string;
          cancel_requested_by: string | null;
        }>(
          `SELECT status, cancel_requested_by
           FROM generation_jobs
           WHERE id = $1`,
          [jobId],
        );
        expect(repairedJob.rows[0]).toEqual({
          status: 'cancelled',
          cancel_requested_by: userId,
        });

        const report = await checkDeploymentDataInvariants(runner);
        expect(report).toEqual({
          ok: true,
          checkedCount: 50,
          violations: [],
        });
      } finally {
        await target.end();
      }
    } finally {
      await admin.query(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
      );
      await admin.end();
      await rm(legacyMigrationsDirectory, { force: true, recursive: true });
    }
  }, 30_000);
});

async function prepareLegacyMigrationDirectory(
  migrationsDirectory: string,
): Promise<void> {
  const currentMigrationsDirectory = join(process.cwd(), 'migrations');
  const baselineMigrations = (await readdir(currentMigrationsDirectory))
    .filter((filename) => /^\d{3}_.+\.sql$/u.test(filename))
    .sort()
    .slice(0, 23);

  for (const filename of baselineMigrations) {
    await cp(
      join(currentMigrationsDirectory, filename),
      join(migrationsDirectory, filename),
    );
  }

  for (const [legacyFilename, canonicalFilename] of CONTENT_EQUIVALENT_LEGACY_MIGRATIONS) {
    await cp(
      join(currentMigrationsDirectory, canonicalFilename),
      join(migrationsDirectory, legacyFilename),
    );
  }

  const legacyFixtureDirectory = join(
    process.cwd(),
    'tests',
    'fixtures',
    'migrations',
    'legacy-mobile',
  );
  for (const filename of [
    '027_add_generation_job_management.sql',
    '032_add_processing_generation_job_cancellation.sql',
  ]) {
    await cp(
      join(legacyFixtureDirectory, filename),
      join(migrationsDirectory, filename),
    );
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

class ClientMigrationRunner implements MigrationRunnerPort {
  public constructor(private readonly client: Client) {}

  public query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.client.query<T>(text, values as unknown[]);
  }

  public async transaction<T>(
    work: (client: MigrationRunnerPort) => Promise<T>,
  ): Promise<T> {
    await this.client.query('BEGIN');

    try {
      const result = await work(this);
      await this.client.query('COMMIT');
      return result;
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }
}
