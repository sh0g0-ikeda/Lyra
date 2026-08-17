import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresEpisodePageSkeletonExecutionRepository } from '../../../src/repositories/EpisodePageSkeletonExecutionRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public queries: string[] = [];
  public values: Array<readonly unknown[] | undefined> = [];
  public beginCommitSucceeds = true;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);

    if (text.includes('SET commit_started_at = NOW()')) {
      return queryResult(this.beginCommitSucceeds ? [{}] as unknown as T[] : []);
    }

    return queryResult([{}] as unknown as T[]);
  }
}

describe('PostgresEpisodePageSkeletonExecutionRepository', () => {
  it('停止要求済みなら skeleton job の保存開始 gate を通過させない', async () => {
    const client = new QueryCapturingClient();
    client.beginCommitSucceeds = false;
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await expect(
      repository.beginEpisodePageSkeletonCommit('job-1', 'user-1'),
    ).resolves.toBe(false);

    expect(client.queries[0]).toContain('SET commit_started_at = NOW()');
    expect(client.queries[0]).toContain("job_type = 'episode_page_skeleton'");
    expect(client.queries[0]).toContain('cancel_requested_at IS NULL');
    expect(client.queries[0]).toContain('commit_started_at IS NULL');
  });

  it('停止要求がなければ skeleton job の保存開始 gate を通過させる', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await expect(
      repository.beginEpisodePageSkeletonCommit('job-1', 'user-1'),
    ).resolves.toBe(true);
  });

  it('skeleton job は commit gate を通過した場合だけ完了にできる', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await expect(repository.completeEpisodePageSkeleton({
      jobId: 'job-1',
      userId: 'user-1',
      result: { pagesCreated: 2, panelsCreated: 8, replacedExisting: true },
      storyPlanApplied: true,
      storyPlanResult: null,
    })).resolves.toBe(true);

    expect(client.queries[0]).toContain('cancel_requested_at IS NULL');
    expect(client.queries[0]).toContain('commit_started_at IS NOT NULL');
  });
});

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}
