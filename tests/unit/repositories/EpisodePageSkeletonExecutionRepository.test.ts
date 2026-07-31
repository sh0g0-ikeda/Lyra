import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresEpisodePageSkeletonExecutionRepository } from '../../../src/repositories/EpisodePageSkeletonExecutionRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public queries: string[] = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    return {
      command: 'UPDATE',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [jobRow()] as unknown as T[],
    };
  }
}

describe('PostgresEpisodePageSkeletonExecutionRepository cancellation barrier', () => {
  it('停止要求済みのqueued jobをclaimしない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await repository.claimQueuedEpisodePageSkeletonJob('job-1');

    expect(client.queries[0]).toContain('cancel_requested_at IS NULL');
  });

  it('停止要求済みのprocessing jobへprogressを保存しない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await repository.updateEpisodePageSkeletonProgress({
      jobId: 'job-1',
      userId: 'user-1',
      stage: 'compiling',
      message: 'Preparing page skeleton.',
    });

    expect(client.queries[0]).toContain('cancel_requested_at IS NULL');
  });

  it('commit開始済みかつ停止要求なしの場合だけcompletedへ更新する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await repository.completeEpisodePageSkeleton({
      jobId: 'job-1',
      userId: 'user-1',
      result: { pagesCreated: 2, panelsCreated: 8, replacedExisting: false },
      storyPlanApplied: false,
      storyPlanResult: null,
    });

    expect(client.queries[0]).toContain('cancel_requested_at IS NULL');
    expect(client.queries[0]).toContain('commit_started_at IS NOT NULL');
  });

  it('停止要求済みのjobをfailedへ上書きしない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await repository.failEpisodePageSkeleton({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'generator unavailable',
    });

    expect(client.queries[0]).toContain('cancel_requested_at IS NULL');
  });
});

function jobRow(): QueryResultRow {
  return {
    id: 'job-1',
    user_id: 'user-1',
    organization_id: null,
    job_type: 'episode_page_skeleton',
    status: 'processing',
    generation_mode: null,
    credit_cost: 0,
    params: { episode_id: 'episode-1' },
    result: {},
    sqs_message_id: null,
    openai_request_id: null,
    error_message: null,
    retry_count: 0,
    created_at: new Date('2026-07-31T00:00:00.000Z'),
    started_at: new Date('2026-07-31T00:00:01.000Z'),
    completed_at: null,
    expires_at: null,
    cancel_requested_at: null,
    cancel_requested_by: null,
    cancelled_at: null,
    commit_started_at: null,
  };
}
