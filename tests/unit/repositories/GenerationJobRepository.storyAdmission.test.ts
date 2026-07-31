import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresGenerationJobRepository } from '../../../src/repositories/GenerationJobRepository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const pageId = '22222222-2222-4222-8222-222222222222';
const episodeId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';

class StoryAdmissionClient implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];
  public readonly values: Array<readonly unknown[] | undefined> = [];
  public transactionCalls = 0;

  public constructor(private readonly targetAvailable = true) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);

    if (text.includes('COUNT(*)::text AS count')) {
      return resultRows([{ count: '0' }]);
    }
    if (text.includes('story_episode_id')) {
      return resultRows(this.targetAvailable ? [{ story_episode_id: episodeId }] : []);
    }
    if (
      text.includes('generation_jobs.params')
      && text.includes("generation_jobs.status = 'failed'")
    ) {
      return resultRows([
        {
          id: jobId,
          user_id: userId,
          organization_id: null,
          job_type: 'page_generate',
          params: { page_id: pageId },
        },
      ]);
    }
    if (text.includes('INSERT INTO generation_jobs')) {
      return resultRows([generationJobRow()], 'INSERT');
    }
    if (text.includes('WITH retried_job')) {
      return resultRows([{ id: jobId, retry_count: 1, canceled_delivery_count: '0' }]);
    }

    return resultRows([]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return work(this);
  }
}

describe('PostgresGenerationJobRepository story deletion admission', () => {
  it('page job作成はepisodeをscope解決して削除と共通のlock後に再検査する', async () => {
    const client = new StoryAdmissionClient();
    const repository = new PostgresGenerationJobRepository(client);

    await repository.create({
      id: jobId,
      userId,
      jobType: 'page_generate',
      generationMode: 'standard',
      creditCost: 1,
      capacityLimits: { perUser: 3, global: 5 },
      params: { page_id: pageId },
    });

    expect(client.transactionCalls).toBe(1);
    const storyLocks = client.values.filter(
      (values) => values?.[1] === `story:episode:${episodeId}`,
    );
    expect(storyLocks).toHaveLength(1);
    const targetQueries = client.queries.filter((query) => query.includes('story_episode_id'));
    expect(targetQueries).toHaveLength(2);
    expect(targetQueries[1]).toContain('FOR KEY SHARE');
    expect(client.queries.findIndex((query) => query.includes('FOR KEY SHARE')))
      .toBeLessThan(client.queries.findIndex((query) => query.includes('INSERT INTO generation_jobs')));
  });

  it('削除済みpageのjobは作成せず409にする', async () => {
    const client = new StoryAdmissionClient(false);
    const repository = new PostgresGenerationJobRepository(client);

    await expect(repository.create({
      id: jobId,
      userId,
      jobType: 'page_generate',
      generationMode: 'standard',
      creditCost: 1,
      capacityLimits: { perUser: 3, global: 5 },
      params: { page_id: pageId },
    })).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });

    expect(client.queries.some((query) => query.includes('INSERT INTO generation_jobs'))).toBe(false);
  });

  it('failed page jobのretryも同じepisode lockと再検査を通す', async () => {
    const client = new StoryAdmissionClient();
    const repository = new PostgresGenerationJobRepository(client);

    await expect(repository.prepareRetry(jobId, 3, {
      userId,
      capacityLimits: { perUser: 3, global: 5 },
    })).resolves.toBe(true);

    expect(client.values.some((values) => values?.[1] === `story:episode:${episodeId}`)).toBe(true);
    expect(client.queries.filter((query) => query.includes('story_episode_id'))).toHaveLength(2);
    expect(client.queries.findIndex((query) => query.includes('FOR KEY SHARE')))
      .toBeLessThan(client.queries.findIndex((query) => query.includes('WITH retried_job')));
  });
});

function generationJobRow(): Record<string, unknown> {
  return {
    id: jobId,
    user_id: userId,
    organization_id: null,
    job_type: 'page_generate',
    status: 'queued',
    generation_mode: 'standard',
    credit_cost: 1,
    params: { page_id: pageId },
    result: null,
    sqs_message_id: null,
    openai_request_id: null,
    error_message: null,
    retry_count: 0,
    created_at: new Date('2026-07-31T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    expires_at: new Date('2026-08-07T00:00:00.000Z'),
    cancel_requested_at: null,
    cancel_requested_by: null,
    cancelled_at: null,
    commit_started_at: null,
  };
}

function resultRows<T extends QueryResultRow = QueryResultRow>(
  rows: QueryResultRow[],
  command: 'SELECT' | 'INSERT' = 'SELECT',
): QueryResult<T> {
  return {
    command,
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as T[],
  };
}
