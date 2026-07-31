import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresGenerationJobRepository } from '../../../src/repositories/GenerationJobRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public queries: string[] = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [],
    };
  }
}

describe('PostgresGenerationJobRepository capacity configuration', () => {
  it('capacityLimits 指定時に transaction 非対応 client なら job を作成せず設定エラーにする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    await expect(
      repository.create({
        id: '55555555-5555-4555-8555-555555555555',
        userId: 'user-1',
        jobType: 'page_generate',
        generationMode: 'standard',
        creditCost: 1,
        capacityLimits: { perUser: 3, global: 5 },
        params: {
          page_id: '77777777-7777-4777-8777-777777777777',
        },
      }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'Generation job capacity limits require a transaction-capable database client',
    });

    expect(client.queries).toEqual([]);
  });

  it('retry の capacityLimits 指定時も advisory lock 下で上限確認してから queued に戻す', async () => {
    const client = new CapacityTransactionRunner();
    const repository = new PostgresGenerationJobRepository(client);

    const prepared = await repository.prepareRetry('job-1', 3, {
      userId: 'user-1',
      capacityLimits: { perUser: 3, global: 5 },
    });

    expect(prepared).toBe(true);
    expect(client.transactionCalls).toBe(1);
    expect(client.queries.filter((query) => query.includes('pg_advisory_xact_lock'))).toHaveLength(2);
    expect(client.queries.some((query) => query.includes("SET status = 'queued'"))).toBe(true);
    expect(client.valuesList[0]).toEqual([81527, 'generation_jobs:global']);
    expect(client.valuesList[1]).toEqual([81527, 'generation_jobs:user:user-1']);
  });

  it('retry は organizationId がある場合 organization scope の capacity lock を使う', async () => {
    const client = new CapacityTransactionRunner();
    const repository = new PostgresGenerationJobRepository(client);

    const prepared = await repository.prepareRetry('job-1', 3, {
      userId: 'user-1',
      organizationId: '44444444-4444-4444-8444-444444444444',
      capacityLimits: { perUser: 3, global: 5 },
    });

    expect(prepared).toBe(true);
    expect(client.valuesList[0]).toEqual([81527, 'generation_jobs:global']);
    expect(client.valuesList[1]).toEqual([
      81527,
      'generation_jobs:organization:44444444-4444-4444-8444-444444444444',
    ]);
  });

  it('retry の capacityLimits 指定時に transaction 非対応 client なら queued に戻さず設定エラーにする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    await expect(
      repository.prepareRetry('job-1', 3, {
        userId: 'user-1',
        capacityLimits: { perUser: 3, global: 5 },
      }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'Generation job capacity limits require a transaction-capable database client',
    });

    expect(client.queries).toEqual([]);
  });
});

class CapacityTransactionClient implements DatabaseClient {
  public queries: string[] = [];
  public valuesList: Array<readonly unknown[] | undefined> = [];

  public constructor(
    private readonly counts: {
      activeForUser: string;
      activeGlobally: string;
    } = { activeForUser: '1', activeGlobally: '2' },
  ) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.valuesList.push(values);

    if (text.includes('COUNT(*)::text AS count') && text.includes('organization_id IS NULL')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ count: this.counts.activeForUser }] as unknown as T[],
      };
    }

    if (text.includes('COUNT(*)::text AS count')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ count: this.counts.activeGlobally }] as unknown as T[],
      };
    }

    if (
      text.includes('generation_jobs.params')
      && text.includes("generation_jobs.status = 'failed'")
    ) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{
          id: 'job-1',
          user_id: 'user-1',
          organization_id: null,
          job_type: 'entity_generate',
          params: { entity_id: 'entity-1' },
        }] as unknown as T[],
      };
    }

    if (text.includes("SET status = 'queued'")) {
      return {
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [generationJobRow()] as unknown as T[],
      };
    }

    return {
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: [],
    };
  }
}

class CapacityTransactionRunner extends CapacityTransactionClient {
  public transactionCalls = 0;

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return work(this);
  }
}

function generationJobRow(): Record<string, unknown> {
  return {
    id: 'job-1',
    user_id: 'user-1',
    job_type: 'page_generate',
    status: 'queued',
    generation_mode: 'standard',
    credit_cost: 10,
    params: {},
    result: null,
    sqs_message_id: null,
    openai_request_id: null,
    error_message: null,
    retry_count: 1,
    created_at: new Date('2026-04-24T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    expires_at: new Date('2026-05-01T00:00:00.000Z'),
  };
}
