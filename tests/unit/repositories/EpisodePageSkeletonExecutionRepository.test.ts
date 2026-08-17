import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { fingerprintPageSkeletonSource } from '../../../src/domain/pageSkeletonSource.js';
import type { EpisodePageSkeletonContext } from '../../../src/domain/types/storyAi.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresEpisodePageSkeletonExecutionRepository } from '../../../src/repositories/EpisodePageSkeletonExecutionRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public transactionCalls = 0;
  public beginCommitSucceeds = true;
  public completeSucceeds = true;
  public sourceGraphFingerprint = 'empty-page-graph';

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    if (text.includes('SET commit_started_at = NOW()')) {
      return queryResult(this.beginCommitSucceeds ? [{}] as T[] : []);
    }
    if (text.includes('FOR UPDATE OF works, chapters, episodes')) {
      return queryResult([{ episode_id: 'episode-1' }] as unknown as T[]);
    }
    if (text.includes('AS episode_id') && text.includes('scene_involved_entity_ids')) {
      return queryResult([buildSourceRow(this.sourceGraphFingerprint)] as T[]);
    }
    if (text.includes('SELECT episodes.id,') && text.includes('existing_page_count')) {
      return queryResult([
        { id: 'episode-1', page_skeleton_generated: false, existing_page_count: 0 },
      ] as unknown as T[]);
    }
    if (text.includes("SET status = 'completed'")) {
      return queryResult(this.completeSucceeds ? [{}] as T[] : []);
    }
    return queryResult([] as T[]);
  }
}

describe('PostgresEpisodePageSkeletonExecutionRepository', () => {
  it('取消済みなら同一transactionの skeleton 保存境界へ入らない', async () => {
    const client = new QueryCapturingClient();
    client.beginCommitSucceeds = false;
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await expect(repository.commitPreparedEpisodePageSkeleton(buildInput())).resolves.toBeNull();

    expect(client.transactionCalls).toBe(1);
    expect(client.queries).toHaveLength(2);
    expect(client.queries[0]).toContain('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    expect(client.queries[1]).toContain('SET commit_started_at = NOW()');
    expect(client.queries[1]).toContain('cancel_requested_at IS NULL');
    expect(client.queries[1]).toContain('commit_started_at IS NULL');
  });

  it('CAS・認可済みsource再読込・骨格保存・completed更新を同じtransaction clientで実行する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await expect(repository.commitPreparedEpisodePageSkeleton(buildInput())).resolves.toEqual({
      pagesCreated: 0,
      panelsCreated: 0,
      replacedExisting: false,
    });

    expect(client.transactionCalls).toBe(1);
    expect(client.queries.some((query) => query.includes('FOR UPDATE OF works, chapters, episodes'))).toBe(true);
    expect(client.queries.some((query) => query.includes('FROM balloons'))).toBe(true);
    expect(client.queries.some((query) => query.includes('scene_involved_entity_ids'))).toBe(true);
    expect(client.queries.some((query) => query.includes('SET page_skeleton_generated = TRUE'))).toBe(true);
    const completedIndex = client.queries.findIndex((query) => query.includes("SET status = 'completed'"));
    expect(completedIndex).toBeGreaterThan(0);
    expect(client.queries[completedIndex]).toContain('commit_started_at IS NOT NULL');
    expect(client.queries[completedIndex]).toContain('cancel_requested_at IS NULL');
  });

  it('生成中に入力元が変わった場合は既存ページもjob完了状態も更新しない', async () => {
    const client = new QueryCapturingClient();
    client.sourceGraphFingerprint = 'changed-page-graph';
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await expect(repository.commitPreparedEpisodePageSkeleton(buildInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    expect(client.queries.some((query) => query.includes('INSERT INTO pages'))).toBe(false);
    expect(client.queries.some((query) => query.includes("SET status = 'completed'"))).toBe(false);
  });

  it('job完了更新に失敗した場合はtransactionを成功扱いにしない', async () => {
    const client = new QueryCapturingClient();
    client.completeSucceeds = false;
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await expect(repository.commitPreparedEpisodePageSkeleton(buildInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('失敗更新はページ骨格jobだけに限定する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEpisodePageSkeletonExecutionRepository(client);

    await repository.failEpisodePageSkeleton({
      jobId: 'job-1',
      userId: 'user-1',
      errorMessage: 'failed',
    });

    expect(client.queries.at(-1)).toContain("job_type = 'episode_page_skeleton'");
  });
});

function buildInput(): {
  jobId: string;
  userId: string;
  organizationId: null;
  prepared: { context: EpisodePageSkeletonContext; pages: []; sourceFingerprint: string };
  overwriteExisting: boolean;
} {
  const context: EpisodePageSkeletonContext = {
    episodeId: 'episode-1', chapterId: 'chapter-1', workId: 'work-1', workTitle: 'Lyra',
    workGenre: null, worldSetting: null, theme: null, chapterTitle: null, chapterPurpose: null,
    episodeTitle: null, episodePurpose: null, introduction: 'Start', middle: 'Middle',
    climax: 'Climax', endingHook: 'End', estimatedPages: 1, entitiesInvolved: [],
    pageSkeletonGenerated: false, existingPageCount: 0,
    existingPageGraphFingerprint: 'empty-page-graph', entities: [], sceneSummaries: [],
  };
  return {
    jobId: 'job-1', userId: 'user-1', organizationId: null,
    prepared: { context, pages: [], sourceFingerprint: fingerprintPageSkeletonSource(context) },
    overwriteExisting: false,
  };
}

function buildSourceRow(existingPageGraphFingerprint = 'empty-page-graph'): QueryResultRow {
  return {
    episode_id: 'episode-1', chapter_id: 'chapter-1', work_id: 'work-1', work_title: 'Lyra',
    work_genre: null, world_setting: null, theme: null, chapter_title: null, chapter_purpose: null,
    episode_title: null, episode_purpose: null, introduction: 'Start', middle: 'Middle',
    climax: 'Climax', ending_hook: 'End', estimated_pages: 1, entities_involved: [],
    scene_involved_entity_ids: [], page_skeleton_generated: false, existing_page_count: 0,
    existing_page_graph_fingerprint: existingPageGraphFingerprint,
    entities: [], scene_summaries: [],
  };
}

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows };
}
