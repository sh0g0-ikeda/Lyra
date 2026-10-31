import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresGenerationWorkerWarmRepository } from '../../src/repositories/GenerationWorkerWarmRepository.js';
import {
  GenerationWorkerWarmService,
  type GenerationWorkerFloorPort,
} from '../../src/services/generation/GenerationWorkerWarmService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest = process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;
const resourceId = 'integration/test/generation-worker';

interface WarmControlRow extends QueryResultRow {
  lease_until: Date | null;
  last_applied_floor: 0 | 1 | null;
}

class MemoryFloor implements GenerationWorkerFloorPort {
  public readonly calls: Array<{ resourceId: string; floor: 0 | 1; previousFloor: 0 | 1 | null }> = [];

  public constructor(private failuresRemaining = 0) {}

  public async applyFloor(resourceId: string, floor: 0 | 1, previousFloor: 0 | 1 | null): Promise<void> {
    this.calls.push({ resourceId, floor, previousFloor });
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('simulated capacity update failure');
    }
  }
}

describePostgres('generation worker warm control', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schemaName: string;

  beforeAll(async () => {
    adminPool = createPool();
    schemaName = `generation_warm_${process.pid}_${Date.now()}`;
    assertSafeSchemaName(schemaName);
    await adminPool.query(`CREATE SCHEMA ${schemaName}`);
    pool = createPool(schemaName);
    const applied = await withPostgresTestMigrationLock(adminPool, () => runPendingMigrations(
      new PoolTransactionDatabase(pool),
      { migrationLockPollMs: 1, migrationLockMaxAttempts: 10 },
    ));
    expect(applied.at(-1)).toBe('040_add_generation_worker_warm_control.sql');
  }, 120_000);

  beforeEach(async () => {
    await pool.query('DELETE FROM generation_worker_warm_controls WHERE resource_id = $1', [resourceId]);
  });

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (adminPool !== undefined && schemaName !== undefined) {
      assertSafeSchemaName(schemaName);
      await adminPool.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await adminPool.end();
    }
  });

  it('別APIの同時予熱でも共有leaseとfloorをtransactionで維持する', async () => {
    const floor = new MemoryFloor();
    const first = createService(floor);
    const second = createService(floor);

    await Promise.all([first.requestWarm(), second.requestWarm()]);

    const state = await readWarmControl();
    expect(state.last_applied_floor).toBe(1);
    expect(state.lease_until).not.toBeNull();
    expect(state.lease_until?.getTime()).toBeGreaterThanOrEqual(Date.now() + (19 * 60 * 1000));
    expect(floor.calls).toHaveLength(2);
    expect(floor.calls.every((call) => call.resourceId === resourceId && call.floor === 1)).toBe(true);
  });

  it('AWS floor更新が失敗してもleaseをcommitし、次reconcileでfloorを記録する', async () => {
    const failureReports: string[] = [];
    const failingFloor = new MemoryFloor(1);
    const failedService = createService(failingFloor, () => failureReports.push('reported'));

    await failedService.requestWarm();
    const afterFailure = await readWarmControl();
    expect(afterFailure.lease_until).not.toBeNull();
    expect(afterFailure.lease_until?.getTime()).toBeGreaterThanOrEqual(Date.now() + (19 * 60 * 1000));
    expect(afterFailure.last_applied_floor).toBeNull();
    expect(failureReports).toEqual(['reported']);

    const succeedingFloor = new MemoryFloor();
    await createService(succeedingFloor).reconcile();

    const afterReconcile = await readWarmControl();
    expect(afterReconcile.last_applied_floor).toBe(1);
    expect(succeedingFloor.calls).toEqual([{ resourceId, floor: 1, previousFloor: null }]);
  });

  function createService(floor: GenerationWorkerFloorPort, reportFailure?: () => void): GenerationWorkerWarmService {
    return new GenerationWorkerWarmService(
      new PostgresGenerationWorkerWarmRepository(new PoolTransactionDatabase(pool)),
      floor,
      resourceId,
      reportFailure,
    );
  }

  async function readWarmControl(): Promise<WarmControlRow> {
    const result = await pool.query<WarmControlRow>(
      'SELECT lease_until, last_applied_floor FROM generation_worker_warm_controls WHERE resource_id = $1',
      [resourceId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('generation worker warm control row was not created');
    return row;
  }
});

function createPool(schemaName?: string): Pool {
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required for generation worker warm integration tests');
  return new Pool({
    connectionString: databaseUrl,
    max: 4,
    ...(schemaName === undefined ? {} : { options: `-c search_path=${schemaName},public` }),
  });
}

function assertSafeSchemaName(schemaName: string): void {
  if (!/^generation_warm_[0-9]+_[0-9]+$/u.test(schemaName)) throw new Error('Unsafe PostgreSQL test schema name');
}

class PoolTransactionDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool) {}

  public async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values === undefined ? undefined : [...values]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({
        query: async <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>> =>
          client.query<R>(text, values === undefined ? undefined : [...values]),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await rollbackIfOpen(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function rollbackIfOpen(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The connection may already be outside a transaction after COMMIT.
  }
}
