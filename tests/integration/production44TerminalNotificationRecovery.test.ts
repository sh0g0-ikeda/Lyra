import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import {
  createTerminalGenerationNotificationRecoveryRepository,
} from '../../src/repositories/TerminalGenerationNotificationRecoveryRepository.js';
import {
  TerminalGenerationNotificationRecoveryService,
} from '../../src/services/notification/TerminalGenerationNotificationRecoveryService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const dbDescribe = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const cutover = '2026-01-01T00:00:00.000Z';
const historical = '2025-12-31T23:59:59.999Z';
const jobTypes = ['page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton'] as const;
type LegacyJobType = typeof jobTypes[number];

interface OldGenerationJobRepository {
  markFailed(jobId: string, message: string): Promise<boolean>;
}

interface Fixture {
  jobId: string;
  userId: string;
  tokenId: string;
  jobType: LegacyJobType;
}

dbDescribe('実44の旧writer終端通知recovery', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  let OldJobs: new (client: DatabaseClient) => OldGenerationJobRepository;
  const schema = `production44_notification_recovery_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    expect(schema).toMatch(/^production44_notification_recovery_[0-9]+_[0-9]+$/u);
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public -c idle_in_transaction_session_timeout=30000 -c statement_timeout=30000`,
      max: 8,
      connectionTimeoutMillis: 5000,
    });
    database = testDatabase(pool);
    const migrations = await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, {
      migrationsDir: join(process.cwd(), 'tests/fixtures/production44-pg18'),
    }));
    expect(migrations).toHaveLength(44);
    const oldRoot = join(process.cwd(), 'tests/fixtures/production44-pg18/old-runtime/runtime');
    const oldModule = await import(pathToFileURL(join(oldRoot, 'src/repositories/GenerationJobRepository.js')).href) as {
      PostgresGenerationJobRepository: new (client: DatabaseClient) => OldGenerationJobRepository;
    };
    OldJobs = oldModule.PostgresGenerationJobRepository;
  }, 120_000);

  beforeEach(async () => {
    await pool.query('TRUNCATE users, organizations CASCADE');
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('固定cutover後に旧writerが作った4種completed/failedだけを一回通知する', async () => {
    const eligible: Fixture[] = [];
    for (const jobType of jobTypes) {
      const completed = await seed(jobType);
      await oldShapedComplete(completed.jobId);
      eligible.push(completed);
      const failed = await seed(jobType);
      expect(await new OldJobs(database).markFailed(failed.jobId, 'old compiled failure')).toBe(true);
      eligible.push(failed);
    }
    const old = await seed('entity_generate');
    await oldShapedComplete(old.jobId, historical);
    const cancelled = await seed('page_generate');
    await cancel(cancelled);
    const cancellationRequested = await seed('episode_story_autofill');
    await oldShapedComplete(cancellationRequested.jobId);
    await pool.query(
      'UPDATE generation_jobs SET cancel_requested_at=NOW(),cancel_requested_by=user_id WHERE id=$1',
      [cancellationRequested.jobId],
    );
    const deleting = await seed('episode_page_skeleton');
    await oldShapedComplete(deleting.jobId);
    await pool.query('UPDATE users SET account_deletion_started_at=NOW() WHERE id=$1', [deleting.userId]);

    expect(await countOutbox()).toBe(0);
    const repository = await createTerminalGenerationNotificationRecoveryRepository(database, 'production44_pg18_v1');
    const service = new TerminalGenerationNotificationRecoveryService(repository, cutover, 100);
    await expect(service.run()).resolves.toMatchObject({ scanned: 8, inserted: 8, existing: 0, deferred: 0, failed: 0 });
    expect(await countOutbox()).toBe(8);
    expect(await countDeliveries()).toBe(8);
    expect((await pool.query(
      'SELECT generation_job_id,terminal_status,generation_retry_count FROM mobile_push_notification_outbox ORDER BY generation_job_id',
    )).rows).toHaveLength(eligible.length);
    for (const excluded of [old, cancelled, cancellationRequested, deleting]) {
      expect(await countOutbox(excluded.jobId)).toBe(0);
    }
    await expect(service.run()).resolves.toMatchObject({ scanned: 0, inserted: 0, wrapped: true });
    expect(await countOutbox()).toBe(8);
  });

  it('scan後のprocessing/retry競合では旧failureを通知せず最新terminal世代だけを通知する', async () => {
    const fixture = await seed('entity_generate');
    await pool.query(
      "UPDATE generation_jobs SET status='failed',completed_at=$2::timestamptz,error_message='historical' WHERE id=$1",
      [fixture.jobId, historical],
    );
    const repository = await createTerminalGenerationNotificationRecoveryRepository(database, 'production44_pg18_v1');
    expect(await repository.scanBatch({ cutover, afterId: null, limit: 10 })).toEqual([]);

    await pool.query(
      "UPDATE generation_jobs SET status='processing',retry_count=1,started_at=NOW(),completed_at=NULL,error_message=NULL WHERE id=$1",
      [fixture.jobId],
    );
    expect(await new OldJobs(database).markFailed(fixture.jobId, 'new retry failure')).toBe(true);
    expect(await repository.scanBatch({ cutover, afterId: null, limit: 10 })).toEqual([{ jobId: fixture.jobId }]);
    await pool.query(
      "UPDATE generation_jobs SET status='processing',retry_count=2,started_at=NOW(),completed_at=NULL,error_message=NULL WHERE id=$1",
      [fixture.jobId],
    );
    await expect(repository.enqueueCurrentTerminal(fixture.jobId)).resolves.toBe('deferred');
    expect(await countOutbox(fixture.jobId)).toBe(0);

    expect(await new OldJobs(database).markFailed(fixture.jobId, 'latest retry failure')).toBe(true);
    await expect(repository.enqueueCurrentTerminal(fixture.jobId)).resolves.toBe('inserted');
    await expect(repository.enqueueCurrentTerminal(fixture.jobId)).resolves.toBe('existing');
    expect((await pool.query(
      'SELECT terminal_status,generation_retry_count FROM mobile_push_notification_outbox WHERE generation_job_id=$1',
      [fixture.jobId],
    )).rows).toEqual([{ terminal_status: 'failed', generation_retry_count: 2 }]);
    expect(await countDeliveries(fixture.jobId)).toBe(1);
  });

  it('scan SQL failureと一行enqueue failureを分離しpoison後の行を救済する', async () => {
    const first = await seed('page_generate', '00000000-0000-0000-0000-000000000001');
    const second = await seed('entity_generate', '00000000-0000-0000-0000-000000000002');
    await oldShapedComplete(first.jobId);
    await oldShapedComplete(second.jobId);
    let failScan = true;
    let failFirst = true;
    const faultDatabase: DatabaseClient & TransactionRunner = {
      transaction: database.transaction,
      query: async <Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => {
        if (failScan && sql.includes('FROM generation_jobs') && sql.includes('NOT EXISTS')) {
          failScan = false;
          throw new Error('private scan SQL');
        }
        return database.query<Row>(sql, values);
      },
    };
    const base = await createTerminalGenerationNotificationRecoveryRepository(faultDatabase, 'production44_pg18_v1');
    const repository = {
      ...base,
      profile: base.profile,
      scanBatch: base.scanBatch.bind(base),
      enqueueCurrentTerminal: async (jobId: string) => {
        if (failFirst && jobId === first.jobId) {
          failFirst = false;
          throw new Error('private row SQL');
        }
        return base.enqueueCurrentTerminal(jobId);
      },
    };
    const service = new TerminalGenerationNotificationRecoveryService(repository, cutover, 2);
    const scanFailure = await service.run();
    expect(scanFailure).toMatchObject({ scanFailed: true, scanned: 0 });
    expect(JSON.stringify(scanFailure)).not.toContain('private');
    const rows = await service.run();
    expect(rows).toMatchObject({ scanFailed: false, scanned: 2, inserted: 1, failed: 1 });
    expect(await countOutbox(first.jobId)).toBe(0);
    expect(await countOutbox(second.jobId)).toBe(1);
  });

  async function seed(jobType: LegacyJobType, jobId = randomUUID()): Promise<Fixture> {
    const fixture = { jobId, jobType, userId: randomUUID(), tokenId: randomUUID() };
    await pool.query(
      'INSERT INTO users(id,supabase_id,email) VALUES($1::uuid,$1::text,$2)',
      [fixture.userId, `${fixture.userId}@example.invalid`],
    );
    await pool.query(
      "INSERT INTO mobile_push_tokens(id,user_id,installation_id,platform,locale,token_hash,token_ciphertext,encryption_key_id) VALUES($1,$2,$3,'android','ja',$4,$5,'test-v1')",
      [
        fixture.tokenId,
        fixture.userId,
        randomUUID(),
        fixture.tokenId.replaceAll('-', '').repeat(2),
        `v1.${'b'.repeat(16)}.${'c'.repeat(40)}.${'d'.repeat(22)}`,
      ],
    );
    await pool.query(
      "INSERT INTO generation_jobs(id,user_id,job_type,status,credit_cost,params) VALUES($1,$2,$3,'processing',0,'{}')",
      [fixture.jobId, fixture.userId, fixture.jobType],
    );
    return fixture;
  }

  async function oldShapedComplete(jobId: string, completedAt?: string): Promise<void> {
    await pool.query(
      "UPDATE generation_jobs SET status='completed',completed_at=COALESCE($2::timestamptz,NOW()) WHERE id=$1 AND status='processing'",
      [jobId, completedAt ?? null],
    );
  }

  async function cancel(fixture: Fixture): Promise<void> {
    await pool.query(
      "UPDATE generation_jobs SET status='cancelled',cancel_requested_at=NOW(),cancel_requested_by=user_id,cancelled_at=NOW(),completed_at=NOW() WHERE id=$1",
      [fixture.jobId],
    );
  }

  async function countOutbox(jobId?: string): Promise<number> {
    const result = jobId === undefined
      ? await pool.query('SELECT COUNT(*)::int AS count FROM mobile_push_notification_outbox')
      : await pool.query('SELECT COUNT(*)::int AS count FROM mobile_push_notification_outbox WHERE generation_job_id=$1', [jobId]);
    return result.rows[0]?.count as number;
  }

  async function countDeliveries(jobId?: string): Promise<number> {
    const result = jobId === undefined
      ? await pool.query('SELECT COUNT(*)::int AS count FROM mobile_push_notification_deliveries')
      : await pool.query(
        'SELECT COUNT(*)::int AS count FROM mobile_push_notification_deliveries WHERE outbox_id IN (SELECT id FROM mobile_push_notification_outbox WHERE generation_job_id=$1)',
        [jobId],
      );
    return result.rows[0]?.count as number;
  }
});

function testDatabase(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => pool.query<Row>(sql, values),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await work({
          query: async <Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => client.query<Row>(sql, values),
        });
        await client.query('COMMIT');
        return value;
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
