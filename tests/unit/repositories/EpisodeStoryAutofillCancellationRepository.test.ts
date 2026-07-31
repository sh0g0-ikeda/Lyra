import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresEpisodeStoryAutofillExecutionRepository } from '../../../src/repositories/EpisodeStoryAutofillExecutionRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public values: Array<readonly unknown[] | undefined> = [];
  public nextRowCount = 1;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);
    return {
      command: 'UPDATE',
      rowCount: this.nextRowCount,
      oid: 0,
      fields: [],
      rows: [],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('PostgresEpisodeStoryAutofillExecutionRepository cancellation', () => {
  it('停止要求済みのジョブを claim しない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodeStoryAutofillExecutionRepository(client);

    await repository.claimQueuedEpisodeStoryAutofillJob('job-1');

    expect(client.queries[0]).toContain('cancel_requested_at IS NULL');
  });

  it('保存開始時は停止要求がない processing job にだけ印を設定する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodeStoryAutofillExecutionRepository(client);

    const started = await repository.beginEpisodeStoryAutofillCommit('job-1', 'user-1');

    expect(started).toBe(true);
    expect(client.queries[0]).toContain('commit_started_at = NOW()');
    expect(client.queries[0]).toContain('cancel_requested_at IS NULL');
    expect(client.values[0]).toEqual(['job-1', 'user-1']);
  });

  it('保存開始前に停止要求済みの processing job だけを cancelled にする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodeStoryAutofillExecutionRepository(client);

    const cancelled = await repository.cancelEpisodeStoryAutofill('job-1', 'user-1');

    expect(cancelled).toBe(true);
    expect(client.queries[0]).toContain("SET status = 'cancelled'");
    expect(client.queries[0]).toContain('cancelled_at = COALESCE(cancelled_at, NOW())');
    expect(client.queries[0]).toContain('completed_at = COALESCE(completed_at, NOW())');
    expect(client.queries[0]).toContain('cancel_requested_at IS NOT NULL');
    expect(client.queries[0]).toContain('commit_started_at IS NULL');
  });
});
