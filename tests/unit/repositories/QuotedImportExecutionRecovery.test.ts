import type { QueryResult, QueryResultRow } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationQuote } from '../../../src/domain/types/generationQuote.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresGenerationJobRepository } from '../../../src/repositories/GenerationJobRepository.js';
import { PostgresGenerationQuoteRepository } from '../../../src/repositories/GenerationQuoteRepository.js';
import { PostgresQuotedImportExecutionRepository } from '../../../src/repositories/QuotedImportExecutionRepository.js';

class RecoveryBatchDatabase implements DatabaseClient, TransactionRunner {
  public sql = '';

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<QueryResult<T>> {
    this.sql = text;
    if (!text.includes("j.job_type='entity_import_analysis'")) {
      throw new Error(`Unexpected query: ${text}`);
    }

    const rows: QueryResultRow[] = [
      { id: '00000000-0000-4000-8000-000000000001', user_id: 'user-1', organization_id: null },
      { id: '00000000-0000-4000-8000-000000000002', user_id: 'user-2', organization_id: null },
    ];
    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as T[],
    };
  }
}

class QuotePruneDatabase implements DatabaseClient, TransactionRunner {
  public sql = '';

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<QueryResult<T>> {
    this.sql = text;
    const rows: QueryResultRow[] = [{ id: '00000000-0000-4000-8000-000000000003' }];
    return {
      command: 'DELETE',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as T[],
    };
  }
}

describe('PostgresQuotedImportExecutionRepository recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('削除フェンス済みジョブがあっても同じバッチの後続取込を復旧する', async () => {
    // Deletion owns the fenced job's terminal mutation. Recovery must skip that
    // row so an unrelated charged import in the same bounded batch is settled.
    vi.spyOn(PostgresGenerationJobRepository.prototype, 'finalizeCancellation').mockResolvedValue(false);
    vi.spyOn(PostgresGenerationQuoteRepository.prototype, 'findAcceptedJob').mockResolvedValue({
      plan: { amountCredits: 1 },
    } as GenerationQuote);
    const deletionGuardError = Object.assign(new Error('Work deletion is pending'), {
      constraint: 'work_deletion_write_guard',
    });
    const settle = vi.spyOn(PostgresQuotedImportExecutionRepository.prototype, 'failAndRefund')
      .mockRejectedValueOnce(deletionGuardError)
      .mockResolvedValueOnce(undefined);

    const database = new RecoveryBatchDatabase();
    const repository = new PostgresQuotedImportExecutionRepository(database);

    await expect(repository.recoverExpired()).resolves.toBe(1);
    expect(database.sql).toContain('work_deletion_requests');
    expect(database.sql.indexOf('work_deletion_requests')).toBeLessThan(database.sql.indexOf('LIMIT $1'));
    expect(settle).toHaveBeenCalledTimes(2);
    expect(settle.mock.calls[1]?.[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000002',
      userId: 'user-2',
    });
  });
});

describe('PostgresGenerationQuoteRepository pruning', () => {
  it('削除フェンス中の作品の見積を除外し他の期限切れ見積だけを削除する', async () => {
    // The deletion manifest owns every fenced work row. Quote maintenance must
    // select only unrelated expired quotes and must not mutate the manifest.
    const database = new QuotePruneDatabase();
    const repository = new PostgresGenerationQuoteRepository(database);

    await expect(repository.pruneUnaccepted()).resolves.toBe(1);
    expect(database.sql).toContain('NOT EXISTS');
    expect(database.sql).toContain('work_deletion_requests');
    expect(database.sql).toContain("lyra_work_resource_uuid(q.plan->>'workId')");
  });
});
