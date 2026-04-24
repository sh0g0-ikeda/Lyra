import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresGenerationJobRepository } from '../../../src/repositories/GenerationJobRepository.js';

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

  it('user_idで所有権を絞ってjobを取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresGenerationJobRepository(client);

    const job = await repository.findByIdAndUserId('job-1', 'user-1');

    expect(client.queries[0]).toContain('user_id = $2');
    expect(client.values).toEqual(['job-1', 'user-1']);
    expect(job?.userId).toBe('user-1');
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
