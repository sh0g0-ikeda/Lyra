import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresEpisodePageSkeletonExecutionRepository } from '../../../src/repositories/EpisodePageSkeletonExecutionRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public graphError: (Error & { code: string }) | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    if (this.graphError !== undefined && text.includes('FOR UPDATE OF works')) throw this.graphError;
    return {
      command: 'UPDATE',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: (text.includes('account_deletion_requests') ? [] : [jobRow()]) as unknown as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}


class OrganizationRoleClient extends QueryCapturingClient {
  public constructor(private readonly role: unknown) { super(); }
  public override async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    const result = await super.query<T>(text, values);
    const rows = text.includes('FROM organization_members')
      ? [{ organization_id: 'org-1', user_id: 'user-1', status: 'active', role: this.role }]
      : [{ ...jobRow(), organization_id: 'org-1' }];
    return { ...result, rows: rows as unknown as T[] };
  }
}

describe('legacy Skeleton commit organization capability', () => {
  it.each(['viewer', 'billing', 'unexpected', '__proto__', 'toString', null])('role=%sの場合はactiveでも編集権限なしとしてgraphより前に拒否する', async (role) => {
    const client = new OrganizationRoleClient(role);
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client, 'legacy_2debe_v1');
    const job = await repository.claimQueuedEpisodePageSkeletonJob('job-1');
    if (job === null) throw new Error('Missing test job');
    await expect(repository.commitPreparedEpisodePageSkeleton(job, {
      userId: job.userId, organizationId: 'org-1', episodeId: 'episode-1', overwriteExisting: false, pages: [], sourceFingerprint: 'fixture',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(client.queries.some((sql) => sql.includes('FOR UPDATE OF works'))).toBe(false);
  });
  it.each(['owner', 'admin', 'editor'])('role=%sの場合は既存edit_work capabilityでgraph確定段階へ進む', async (role) => {
    const client = new OrganizationRoleClient(role);
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client, 'legacy_2debe_v1');
    const job = await repository.claimQueuedEpisodePageSkeletonJob('job-1');
    if (job === null) throw new Error('Missing test job');
    client.graphError = Object.assign(new Error('Reached graph'), { code: '42P01' });
    await expect(repository.commitPreparedEpisodePageSkeleton(job, {
      userId: job.userId, organizationId: 'org-1', episodeId: 'episode-1', overwriteExisting: false, pages: [], sourceFingerprint: 'fixture',
    })).rejects.toBe(client.graphError);
  });
});

describe('PostgresEpisodePageSkeletonExecutionRepository cancellation barrier', () => {
  it.each(['55P03', '40P01', '42P01'])('legacy graphのSQLSTATE %sは55P03だけConflictへ変換し他エラーを隠さない', async (code) => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client, 'legacy_2debe_v1');
    const job = await repository.claimQueuedEpisodePageSkeletonJob('job-1');
    if (job === null) throw new Error('Missing test job');
    client.graphError = Object.assign(new Error('Injected graph SQL failure'), { code });
    let rejection: unknown;
    try {
      await repository.commitPreparedEpisodePageSkeleton(job, {
        userId: job.userId, organizationId: null, episodeId: 'episode-1', overwriteExisting: false, pages: [], sourceFingerprint: 'fixture',
      });
    } catch (error: unknown) { rejection = error; }
    if (code === '55P03') expect(rejection).toMatchObject({ code: 'CONFLICT' });
    else expect(rejection).toBe(client.graphError);
    expect(client.queries.some((sql) => sql.includes('FOR UPDATE OF works, chapters, episodes NOWAIT'))).toBe(true);
  });

  it('canonicalでlegacy atomic portを誤選択した場合は追加SQL前に拒否する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);
    const job = await repository.claimQueuedEpisodePageSkeletonJob('job-1');
    if (job === null) throw new Error('Missing test job');
    client.queries = [];
    let rejection: unknown;
    try {
      await repository.commitPreparedEpisodePageSkeleton(job, {
        userId: job.userId, organizationId: null, episodeId: 'episode-1', overwriteExisting: false, pages: [],
      });
    } catch (error: unknown) { rejection = error; }
    expect(rejection).toBeInstanceOf(Error);
    expect(client.queries).toEqual([]);
    rejection = undefined;
    try { await repository.settleEpisodePageSkeletonAttempt(job); }
    catch (error: unknown) { rejection = error; }
    expect(rejection).toBeInstanceOf(Error);
    expect(client.queries).toEqual([]);
  });

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

    expect(client.queries[0]).toContain('pg_advisory_xact_lock');
    expect(client.queries[1]).toContain('cancel_requested_at IS NULL');
    expect(client.queries[1]).toContain('commit_started_at IS NOT NULL');
    expect(client.queries.some((sql) =>
      sql.includes('INSERT INTO mobile_push_notification_outbox')
    )).toBe(true);
  });

  it('停止要求済みのjobをfailedへ上書きしない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await repository.failEpisodePageSkeleton({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'generator unavailable',
    });

    expect(client.queries[0]).toContain('pg_advisory_xact_lock');
    expect(client.queries[1]).toContain('cancel_requested_at IS NULL');
    expect(client.queries.some((sql) =>
      sql.includes('INSERT INTO mobile_push_notification_outbox')
    )).toBe(true);
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
    params: { episode_id: 'episode-1', overwrite_existing: false },
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
