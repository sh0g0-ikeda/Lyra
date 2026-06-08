import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import {
  isUniqueViolation,
  PostgresGenerationJobRepository,
} from '../../../src/repositories/GenerationJobRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public queries: string[] = [];
  public values: readonly unknown[] | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [jobRow()] as unknown as T[],
    };
  }
}

describe('PostgresGenerationJobRepository', () => {
  it('job作成時にparamsとcredit_costを保存する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const job = await repository.create({
      userId: 'user-1',
      jobType: 'page_generate',
      generationMode: 'standard',
      creditCost: 10,
      params: {
        page_id: 'page-1',
        request_kind: 'initial',
        generation_mode: 'standard',
        quality: 'medium',
        requires_planner: false,
      },
    });

    expect(client.queries[0]).toContain('INSERT INTO generation_jobs');
    expect(client.values).toEqual([
      null,
      'user-1',
      'page_generate',
      'standard',
      10,
      JSON.stringify({
        page_id: 'page-1',
        request_kind: 'initial',
        generation_mode: 'standard',
        quality: 'medium',
        requires_planner: false,
      }),
    ]);
    expect(job.id).toBe('job-1');
  });

  it('指定された job id で generation job を作成できる', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.create({
      id: '55555555-5555-4555-8555-555555555555',
      userId: 'user-1',
      jobType: 'entity_generate',
      generationMode: null,
      creditCost: 1,
      params: {
        entity_id: 'entity-1',
      },
    });

    expect(client.queries[0]).toContain('COALESCE($1::uuid, gen_random_uuid())');
    expect(client.values).toEqual([
      '55555555-5555-4555-8555-555555555555',
      'user-1',
      'entity_generate',
      null,
      1,
      JSON.stringify({
        entity_id: 'entity-1',
      }),
    ]);
  });

  it('capacityLimits 指定時は advisory lock 下で上限確認してから job を作成する', async () => {
    const client = new CapacityTransactionRunner();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.create({
      id: '55555555-5555-4555-8555-555555555555',
      userId: 'user-1',
      jobType: 'page_generate',
      generationMode: 'standard',
      creditCost: 1,
      capacityLimits: { perUser: 3, global: 5 },
      params: {
        page_id: 'page-1',
      },
    });

    expect(client.transactionCalls).toBe(1);
    expect(client.queries.filter((query) => query.includes('pg_advisory_xact_lock'))).toHaveLength(2);
    expect(client.queries.some((query) => query.includes('INSERT INTO generation_jobs'))).toBe(true);
    expect(client.valuesList[0]).toEqual([81527, 'generation_jobs:global']);
    expect(client.valuesList[1]).toEqual([81527, 'generation_jobs:user:user-1']);
  });

  it('capacityLimits 指定時に user 上限へ達していれば job を作成しない', async () => {
    const client = new CapacityTransactionRunner({ activeForUser: '3', activeGlobally: '3' });
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
          page_id: 'page-1',
        },
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'User has too many active generation jobs',
    });

    expect(client.queries.some((query) => query.includes('INSERT INTO generation_jobs'))).toBe(false);
  });

  it('capacityLimits 指定時に global 上限へ達していれば job を作成しない', async () => {
    const client = new CapacityTransactionRunner({ activeForUser: '1', activeGlobally: '5' });
    const repository = new PostgresGenerationJobRepository(client);

    await expect(
      repository.create({
        id: '55555555-5555-4555-8555-555555555555',
        userId: 'user-1',
        jobType: 'entity_generate',
        generationMode: null,
        creditCost: 1,
        capacityLimits: { perUser: 3, global: 5 },
        params: {
          entity_id: 'entity-1',
        },
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Generation queue is temporarily full',
    });

    expect(client.queries.some((query) => query.includes('INSERT INTO generation_jobs'))).toBe(false);
  });

  it('user_idで所有権を絞ってjobを取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const job = await repository.findByIdAndUserId('job-1', 'user-1');

    expect(client.queries[0]).toContain('user_id = $2');
    expect(client.values).toEqual(['job-1', 'user-1']);
    expect(job?.userId).toBe('user-1');
  });

  it('active page generation job は page_id で取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const job = await repository.findActivePageGenerationJob('user-1', 'page-1');

    expect(client.queries[0]).toContain("status IN ('queued', 'processing')");
    expect(client.queries[0]).toContain('params->>$3 = $4');
    expect(client.values).toEqual(['user-1', 'page_generate', 'page_id', 'page-1']);
    expect(job?.id).toBe('job-1');
  });

  it('active entity generation job は entity_id で取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.findActiveEntityGenerationJob('user-1', 'entity-1');

    expect(client.values).toEqual(['user-1', 'entity_generate', 'entity_id', 'entity-1']);
  });

  it('user active generation job 数を集計する', async () => {
    const client = new CountCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const count = await repository.countActiveGenerationJobsByUser('user-1');

    expect(client.queries[0]).toContain("status IN ('queued', 'processing')");
    expect(client.queries[0]).toContain("job_type IN ('page_generate', 'entity_generate')");
    expect(client.values).toEqual(['user-1']);
    expect(count).toBe(2);
  });

  it('global active generation job 数を集計する', async () => {
    const client = new CountCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const count = await repository.countActiveGenerationJobs();

    expect(client.queries[0]).toContain("status IN ('queued', 'processing')");
    expect(client.values).toBeUndefined();
    expect(count).toBe(2);
  });

  it('failed job を retry 用に queued へ戻す', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const prepared = await repository.prepareRetry('job-1', 3);

    expect(prepared).toBe(true);
    expect(client.queries[0]).toContain("SET status = 'queued'");
    expect(client.queries[0]).toContain('retry_count = retry_count + 1');
    expect(client.values).toEqual(['job-1', 3]);
  });

  it('Postgres unique violation を識別する', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });
});

function jobRow(): Record<string, unknown> {
  return {
    id: 'job-1',
    user_id: 'user-1',
    job_type: 'page_generate',
    status: 'queued',
    generation_mode: 'standard',
    credit_cost: 10,
    params: {
      page_id: 'page-1',
      request_kind: 'initial',
      generation_mode: 'standard',
      quality: 'medium',
      requires_planner: false,
    },
    result: null,
    sqs_message_id: null,
    openai_request_id: null,
    error_message: null,
    retry_count: 0,
    created_at: new Date('2026-04-24T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    expires_at: new Date('2026-05-01T00:00:00.000Z'),
  };
}

class CountCapturingClient implements DatabaseClient {
  public queries: string[] = [];
  public values: readonly unknown[] | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [{ count: '2' }] as unknown as T[],
    };
  }
}

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

    if (text.includes('COUNT(*)::text AS count') && text.includes('user_id = $1')) {
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

    if (text.includes('INSERT INTO generation_jobs')) {
      return {
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [jobRow()] as unknown as T[],
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
