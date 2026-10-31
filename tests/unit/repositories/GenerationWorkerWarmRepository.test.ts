import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresGenerationWorkerWarmRepository } from '../../../src/repositories/GenerationWorkerWarmRepository.js';

describe('PostgresGenerationWorkerWarmRepository', () => {
  it('ロック中にleaseとfloorを更新した場合はcommit後の状態を次の処理へ渡す', async () => {
    const database = new TransactionalWarmDatabase();
    const repository = new PostgresGenerationWorkerWarmRepository(database);

    await repository.withLock('service/worker', async (state) => {
      expect(await state.hasActiveJobs()).toBe(false);
      await state.extendLease(1_200);
      await state.recordAppliedFloor(1);
    });

    const result = await repository.withLock('service/worker', async (state) => ({
      leaseUntil: state.leaseUntil,
      floor: state.lastAppliedFloor,
    }));

    expect(result.leaseUntil).toEqual(new Date('2026-10-31T00:20:00.000Z'));
    expect(result.floor).toBe(1);
    expect(database.committed.advisoryLocks).toBe(2);
    expect(database.committed.rowLocks).toBe(2);
  });

  it('保護更新後にAWS側失敗を表す例外が起きた場合はtransactionをrollbackする', async () => {
    const database = new TransactionalWarmDatabase();
    const repository = new PostgresGenerationWorkerWarmRepository(database);

    await expect(repository.withLock('service/worker', async (state) => {
      await state.extendLease(1_200);
      throw new Error('capacity update failed');
    })).rejects.toThrow('capacity update failed');

    expect(database.committed.leaseUntil).toBeNull();
    expect(database.rollbacks).toBe(1);
  });
});

interface WarmState {
  leaseUntil: Date | null;
  floor: 0 | 1 | null;
  advisoryLocks: number;
  rowLocks: number;
}

class TransactionalWarmDatabase implements TransactionRunner {
  public committed: WarmState = { leaseUntil: null, floor: null, advisoryLocks: 0, rowLocks: 0 };
  public rollbacks = 0;

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const pending: WarmState = {
      leaseUntil: this.committed.leaseUntil,
      floor: this.committed.floor,
      advisoryLocks: this.committed.advisoryLocks,
      rowLocks: this.committed.rowLocks,
    };
    try {
      const result = await work(new WarmDatabaseClient(pending));
      this.committed = pending;
      return result;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

class WarmDatabaseClient implements DatabaseClient {
  public constructor(private readonly state: WarmState) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    if (text.startsWith('SET LOCAL lock_timeout')) {
      return result([]);
    }
    if (text.includes('pg_advisory_xact_lock')) {
      this.state.advisoryLocks += 1;
      return result([]);
    }
    if (text.startsWith('INSERT INTO generation_worker_warm_controls')) {
      return result([]);
    }
    if (text.includes('FOR UPDATE')) {
      this.state.rowLocks += 1;
      return result([{ lease_until: this.state.leaseUntil, last_applied_floor: this.state.floor, now: new Date('2026-10-31T00:00:00.000Z') }]);
    }
    if (text.includes('SELECT EXISTS')) {
      return result([{ active: false }]);
    }
    if (text.startsWith('UPDATE generation_worker_warm_controls SET lease_until')) {
      const seconds = values?.[1];
      if (typeof seconds !== 'number') throw new Error('lease seconds were not parameterized');
      this.state.leaseUntil = new Date(new Date('2026-10-31T00:00:00.000Z').getTime() + seconds * 1_000);
      return result([{ lease_until: this.state.leaseUntil }]);
    }
    if (text.startsWith('UPDATE generation_worker_warm_controls SET last_applied_floor')) {
      const floor = values?.[1];
      if (floor !== 0 && floor !== 1) throw new Error('floor was not parameterized');
      this.state.floor = floor;
      return result([]);
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

function result<T extends QueryResultRow>(rows: QueryResultRow[]): QueryResult<T> {
  return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows: rows as unknown as T[] };
}
