import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import {
  PostgresGenerationJobRepository,
  type GenerationJobHistoryCursor,
} from '../../../src/repositories/GenerationJobRepository.js';

const viewerId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';

describe('PostgresGenerationJobRepository history management', () => {
  it('personal履歴をowner scope・hide preference・keyset順・limit+1で取得する', async () => {
    const client = new HistoryClient();
    const repository = new PostgresGenerationJobRepository(client);

    const page = await repository.listHistory({
      userId: viewerId,
      organizationId: null,
      limit: 2,
      cursor: null,
    });

    const sql = client.queries[0] ?? '';
    expect(sql).toContain('generation_jobs.user_id = $1::uuid');
    expect(sql).toContain('generation_jobs.organization_id IS NULL');
    expect(sql).toContain('generation_job_history_hides');
    expect(sql).toContain("generation_jobs.status IN ('queued', 'processing')");
    expect(sql).toContain(
      'ORDER BY active_rank ASC, created_at DESC, id DESC',
    );
    expect(client.valuesList[0]).toEqual([
      viewerId,
      null,
      null,
      null,
      null,
      3,
    ]);
    expect(page.jobs).toHaveLength(2);
    expect(page.nextCursor).toEqual({
      activeRank: 1,
      createdAt: new Date('2026-07-30T23:59:00.000Z'),
      id: jobId(4),
    });
  });

  it('organization履歴を指定organizationのactive memberに限定してcursorを渡す', async () => {
    const client = new HistoryClient();
    const repository = new PostgresGenerationJobRepository(client);
    const cursor: GenerationJobHistoryCursor = {
      activeRank: 1,
      createdAt: new Date('2026-07-30T23:59:00.000Z'),
      id: '44444444-4444-4444-8444-444444444444',
    };

    await repository.listHistory({
      userId: viewerId,
      organizationId,
      limit: 25,
      cursor,
    });

    const sql = client.queries[0] ?? '';
    expect(sql).toContain('generation_jobs.organization_id = $2::uuid');
    expect(sql).toContain('FROM organization_members');
    expect(sql).toContain('organization_members.user_id = $1::uuid');
    expect(sql).toContain("organization_members.status = 'active'");
    expect(client.valuesList[0]).toEqual([
      viewerId,
      organizationId,
      1,
      cursor.createdAt,
      cursor.id,
      26,
    ]);
  });

  it('terminal jobをscoped row lock後に冪等非表示にする', async () => {
    const client = new HistoryClient({ hideStatus: 'completed' });
    const repository = new PostgresGenerationJobRepository(client);

    await expect(
      repository.hideFromHistory(viewerId, jobId(1), organizationId),
    ).resolves.toEqual({ kind: 'hidden' });

    expect(client.transactionCalls).toBe(1);
    expect(client.queries[0]).toContain('FOR UPDATE');
    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[1]).toContain(
      'INSERT INTO generation_job_history_hides',
    );
    expect(client.queries[1]).toContain('ON CONFLICT');
    expect(client.valuesList[1]).toEqual([jobId(1), viewerId]);
  });

  it('active jobとscope外jobを非表示にしない', async () => {
    const activeClient = new HistoryClient({ hideStatus: 'processing' });
    const missingClient = new HistoryClient({ hideStatus: null });
    const activeRepository = new PostgresGenerationJobRepository(activeClient);
    const missingRepository = new PostgresGenerationJobRepository(missingClient);

    await expect(
      activeRepository.hideFromHistory(viewerId, jobId(1)),
    ).resolves.toEqual({ kind: 'active' });
    await expect(
      missingRepository.hideFromHistory(viewerId, jobId(1)),
    ).resolves.toEqual({ kind: 'not_found' });
    expect(
      activeClient.queries.some((sql) =>
        sql.includes('INSERT INTO generation_job_history_hides'),
      ),
    ).toBe(false);
    expect(
      missingClient.queries.some((sql) =>
        sql.includes('INSERT INTO generation_job_history_hides'),
      ),
    ).toBe(false);
  });

  it('transaction非対応clientでは非表示を書き込まない', async () => {
    const repository = new PostgresGenerationJobRepository(
      new QueryOnlyHistoryClient(),
    );

    await expect(
      repository.hideFromHistory(viewerId, jobId(1)),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
});

class HistoryClient implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];
  public readonly valuesList: Array<readonly unknown[] | undefined> = [];
  public transactionCalls = 0;

  public constructor(
    private readonly options: {
      hideStatus?: 'cancelled' | 'completed' | 'failed' | 'processing' | null;
    } = {},
  ) {}

  public async transaction<T>(
    work: (client: DatabaseClient) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    return await work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.valuesList.push(values);

    if (text.includes('WITH visible_jobs')) {
      return queryResult([
        historyRow(jobId(3), 'processing', '2026-07-31T00:00:00.000Z', 0),
        historyRow(jobId(4), 'completed', '2026-07-30T23:59:00.000Z', 1),
        historyRow(jobId(5), 'failed', '2026-07-30T23:58:00.000Z', 1),
      ]) as QueryResult<T>;
    }
    if (text.includes('FOR UPDATE')) {
      const status = this.options.hideStatus;
      return status === null
        ? queryResult([])
        : queryResult([
            { status: status ?? 'completed' },
          ]) as unknown as QueryResult<T>;
    }
    return queryResult([]);
  }
}

class QueryOnlyHistoryClient implements DatabaseClient {
  public async query<T extends QueryResultRow = QueryResultRow>(): Promise<
    QueryResult<T>
  > {
    return queryResult([]);
  }
}

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function historyRow(
  id: string,
  status: 'completed' | 'failed' | 'processing',
  createdAt: string,
  activeRank: 0 | 1,
): QueryResultRow {
  return {
    id,
    user_id: viewerId,
    organization_id: null,
    job_type: 'page_generate',
    status,
    generation_mode: 'standard',
    credit_cost: 10,
    params: { page_id: jobId(9) },
    result: null,
    sqs_message_id: null,
    openai_request_id: null,
    error_message: null,
    retry_count: 0,
    created_at: new Date(createdAt),
    started_at: null,
    completed_at: status === 'processing' ? null : new Date(createdAt),
    expires_at: null,
    cancel_requested_at: null,
    cancel_requested_by: null,
    cancelled_at: null,
    commit_started_at: null,
    active_rank: activeRank,
  };
}

function jobId(value: number): string {
  return `${String(value).padStart(8, '0')}-1111-4111-8111-111111111111`;
}
