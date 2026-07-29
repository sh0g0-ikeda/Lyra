import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Client,
  type QueryResult,
  type QueryResultRow,
} from 'pg';
import { describe, expect, it } from 'vitest';
import { checkPreMobileMigrationDataInvariants } from '../../scripts/checkDeploymentDataInvariants.js';
import {
  runPendingMigrations,
  type MigrationRunnerPort,
} from '../../src/lib/migrations.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest =
  process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('pre-mobile-migration invariants on schema 026', () => {
  it('001から026だけを適用した実DBで全preflight queryが成功する', async () => {
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL is required for the PostgreSQL migration test');
    }

    const adminUrl = new URL(databaseUrl);
    const databaseName = `lyra_pre_mobile_${process.pid}_${Date.now()}`;
    const targetUrl = new URL(databaseUrl);
    targetUrl.pathname = `/${databaseName}`;
    const admin = new Client({ connectionString: adminUrl.toString() });
    const migrationsDirectory = await mkdtemp(
      join(tmpdir(), 'lyra-pre-mobile-migrations-'),
    );

    await admin.connect();
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

    try {
      const target = new Client({ connectionString: targetUrl.toString() });
      await target.connect();

      try {
        const migrationNames = (await readdir(join(process.cwd(), 'migrations')))
          .filter((filename) => /^\d{3}_.+\.sql$/u.test(filename))
          .sort()
          .slice(0, 26);
        expect(migrationNames[0]).toBe('001_initial_schema.sql');
        expect(migrationNames.at(-1)).toBe(
          '026_backfill_legacy_credit_consume_job_links.sql',
        );

        for (const filename of migrationNames) {
          await cp(
            join(process.cwd(), 'migrations', filename),
            join(migrationsDirectory, filename),
          );
        }

        const runner = new ClientMigrationRunner(target);
        const applied = await runPendingMigrations(runner, {
          migrationsDir: migrationsDirectory,
          migrationLockMaxAttempts: 1,
          migrationLockPollMs: 0,
        });
        expect(applied).toEqual(migrationNames);

        const report = await checkPreMobileMigrationDataInvariants(runner);
        expect(report).toMatchObject({
          ok: true,
          violations: [],
        });
        expect(report.checkedCount).toBeGreaterThan(20);

        const userId = '10000000-0000-4000-8000-000000000020';
        const jobId = '30000000-0000-4000-8000-000000000020';
        await target.query(
          `INSERT INTO users (id, supabase_id, email)
           VALUES ($1, 'preflight-mismatch-user', 'preflight-mismatch@example.com')`,
          [userId],
        );
        await target.query(
          `INSERT INTO generation_jobs (
             id, user_id, job_type, status, credit_cost, params,
             cancel_requested_at, cancel_requested_by
           )
           VALUES (
             $1, $2, 'page_generate', 'processing', 0, '{}'::JSONB,
             NOW(), NULL
           )`,
          [jobId, userId],
        );

        const mismatchReport =
          await checkPreMobileMigrationDataInvariants(runner);
        expect(mismatchReport.ok).toBe(false);
        expect(mismatchReport.violations).toContainEqual({
          name: 'generation_jobs.cancel_request_metadata_pair',
          sampleIds: [jobId],
        });
      } finally {
        await target.end();
      }
    } finally {
      await admin.query(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
      );
      await admin.end();
      await rm(migrationsDirectory, { force: true, recursive: true });
    }
  }, 30_000);
});

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
