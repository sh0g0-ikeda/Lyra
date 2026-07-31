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
  public valuesList: Array<readonly unknown[] | undefined> = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;
    this.valuesList.push(values);

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [jobRow()] as unknown as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
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
      null,
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
      null,
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
    expect(client.valuesList[2]).toEqual([null, 'user-1', ['page_generate', 'entity_generate']]);
    expect(client.valuesList[3]).toEqual([['page_generate', 'entity_generate']]);
  });

  it('capacityLimits 指定時は organization 単位で advisory lock と上限確認を行う', async () => {
    const client = new CapacityTransactionRunner();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.create({
      id: '55555555-5555-4555-8555-555555555555',
      userId: 'user-1',
      organizationId: '66666666-6666-4666-8666-666666666666',
      jobType: 'page_generate',
      generationMode: 'standard',
      creditCost: 1,
      capacityLimits: { perUser: 3, global: 5 },
      params: {
        page_id: 'page-1',
      },
    });

    expect(client.valuesList[1]).toEqual([
      81527,
      'generation_jobs:organization:66666666-6666-4666-8666-666666666666',
    ]);
    expect(client.valuesList[2]).toEqual([
      '66666666-6666-4666-8666-666666666666',
      'user-1',
      ['page_generate', 'entity_generate'],
    ]);
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
      message: 'Generation scope has too many active generation jobs',
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
    expect(client.values).toEqual(['job-1', 'user-1', null]);
    expect(job?.userId).toBe('user-1');
  });

  it('法人ジョブ取得は指定法人の active member に限定する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.findByIdAndUserId(
      'job-1',
      'user-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(client.queries[0]).toContain('generation_jobs.organization_id = $3::uuid');
    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain("organization_members.status = 'active'");
    expect(client.valuesList[0]).toEqual([
      'job-1',
      'user-1',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('法人ジョブ停止は指定法人の active member に限定する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.requestCancellation(
      'job-1',
      'user-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(client.queries[0]).toContain('generation_jobs.organization_id = $3::uuid');
    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain("organization_members.status = 'active'");
    expect(client.valuesList[0]).toEqual([
      'job-1',
      'user-1',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('active page generation job は page_id で取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const job = await repository.findActivePageGenerationJob('user-1', 'page-1');

    expect(client.queries[0]).toContain("status IN ('queued', 'processing')");
    expect(client.queries[0]).toContain('params->>$3 = $4');
    expect(client.values).toEqual(['user-1', 'page_generate', 'page_id', 'page-1', null]);
    expect(job?.id).toBe('job-1');
  });

  it('組織のactive job取得ではactive memberであることを確認する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.findActivePageGenerationJob(
      'user-1',
      'page-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain('organization_members.user_id = $1');
    expect(client.queries[0]).toContain("organization_members.status = 'active'");
    expect(client.values).toEqual([
      'user-1',
      'page_generate',
      'page_id',
      'page-1',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('active entity generation job は entity_id で取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.findActiveEntityGenerationJob('user-1', 'entity-1');

    expect(client.values).toEqual(['user-1', 'entity_generate', 'entity_id', 'entity-1', null]);
  });

  it('user active generation job 数を集計する', async () => {
    const client = new CountCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const count = await repository.countActiveGenerationJobsByUser('user-1');

    expect(client.queries[0]).toContain("status IN ('queued', 'processing')");
    expect(client.queries[0]).toContain('job_type = ANY($3::text[])');
    expect(client.values).toEqual([null, 'user-1', ['page_generate', 'entity_generate']]);
    expect(count).toBe(2);
  });

  it('global active generation job 数を集計する', async () => {
    const client = new CountCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const count = await repository.countActiveGenerationJobs();

    expect(client.queries[0]).toContain("status IN ('queued', 'processing')");
    expect(client.queries[0]).toContain('job_type = ANY($1::text[])');
    expect(client.values).toEqual([['page_generate', 'entity_generate']]);
    expect(count).toBe(2);
  });

  it('capacityLimits の jobTypes 指定時は対象ジョブ種別だけを数える', async () => {
    const client = new CapacityTransactionRunner();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.create({
      id: '55555555-5555-4555-8555-555555555555',
      userId: 'user-1',
      jobType: 'episode_story_autofill',
      generationMode: null,
      creditCost: 0,
      capacityLimits: {
        perUser: 2,
        global: 5,
        jobTypes: ['episode_story_autofill', 'episode_page_skeleton'],
      },
      params: {
        episode_id: 'episode-1',
      },
    });

    expect(client.valuesList[2]).toEqual([
      null,
      'user-1',
      ['episode_story_autofill', 'episode_page_skeleton'],
    ]);
    expect(client.valuesList[3]).toEqual([
      ['episode_story_autofill', 'episode_page_skeleton'],
    ]);
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

  it('markFailed は保存する error_message からシークレットを伏せて短くする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);
    const fakeApiKey = ['sk', 'testsecret123'].join('-');

    const marked = await repository.markFailed(
      'job-1',
      `OpenAI failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(500)}`,
    );

    expect(marked).toBe(true);
    const persistedMessage = String(client.values?.[1]);
    expect(persistedMessage).toContain('Bearer [redacted]');
    expect(persistedMessage).not.toContain(fakeApiKey);
    expect(persistedMessage.length).toBeLessThanOrEqual(300);
    expect(client.queries[0]).toContain("status IN ('queued', 'processing')");
  });

  it('dry-runでは期限切れの完了済みジョブを削除せず候補として返す', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const result = await repository.pruneExpiredTerminalJobs({
      maxDeletes: 10,
      dryRun: true,
    });

    expect(result).toEqual({
      dryRun: true,
      candidateCount: 1,
      deletedCount: 0,
      candidateIds: ['job-1'],
      truncated: false,
    });
    expect(client.queries[0]).toContain('expires_at < NOW()');
    expect(client.queries[0]).toContain("status IN ('completed', 'failed', 'cancelled')");
    expect(client.queries[0]).toContain('LIMIT $1');
    expect(client.values).toEqual([11]);
    expect(client.queries.some((query) => query.includes('DELETE FROM generation_jobs'))).toBe(false);
  });

  it('apply時だけ期限切れの完了済みジョブを削除する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const result = await repository.pruneExpiredTerminalJobs({
      maxDeletes: 10,
      dryRun: false,
    });

    expect(result.deletedCount).toBe(1);
    expect(result.candidateIds).toEqual(['job-1']);
    expect(client.queries[1]).toContain('DELETE FROM generation_jobs');
    expect(client.queries[1]).toContain('id = ANY($1::uuid[])');
    expect(client.values).toEqual([['job-1']]);
  });

  it('期限切れジョブ削除は候補取得後のretry競合に備えてDELETE時もterminal条件を再確認する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.pruneExpiredTerminalJobs({
      maxDeletes: 10,
      dryRun: false,
    });

    expect(client.queries[1]).toContain('expires_at < NOW()');
    expect(client.queries[1]).toContain("status IN ('completed', 'failed', 'cancelled')");
  });

  it('期限切れジョブ削除の上限値が不正な場合は拒否する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    await expect(
      repository.pruneExpiredTerminalJobs({
        maxDeletes: 0,
        dryRun: true,
      }),
    ).rejects.toThrow(/maxDeletes must be a positive safe integer/);

    expect(client.queries).toEqual([]);
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
