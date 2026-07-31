import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresStoryRepository } from '../../../src/repositories/StoryRepository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const chapterId = '33333333-3333-4333-8333-333333333333';
const firstEpisodeId = '44444444-4444-4444-8444-444444444444';
const secondEpisodeId = '55555555-5555-4555-8555-555555555555';

interface DeletionClientOptions {
  found?: boolean;
  blocked?: boolean;
  episodeIds?: string[];
}

class DeletionClient implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];
  public readonly values: Array<readonly unknown[] | undefined> = [];
  public transactionCalls = 0;

  public constructor(private readonly options: DeletionClientOptions = {}) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);

    if (text.includes('authorized_chapter_id')) {
      return resultRows(this.options.found === false ? [] : [{ authorized_chapter_id: chapterId }]);
    }
    if (text.includes('authorized_episode_id')) {
      return resultRows(this.options.found === false ? [] : [{ authorized_episode_id: firstEpisodeId }]);
    }
    if (text.includes('child_episode_id')) {
      return resultRows(
        (this.options.episodeIds ?? [firstEpisodeId]).map((id) => ({ child_episode_id: id })),
      );
    }
    if (text.includes('deletion_blocked')) {
      return resultRows([{ deletion_blocked: this.options.blocked === true }]);
    }
    if (text.includes('DELETE FROM chapters') || text.includes('DELETE FROM episodes')) {
      return resultRows([{ id: values?.[0] }], 'DELETE');
    }

    return resultRows([]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return work(this);
  }
}

describe('PostgresStoryRepository safe deletion', () => {
  it('話削除は対象episodeとpageをlockしてblocker再検査後だけ削除する', async () => {
    const client = new DeletionClient();
    const repository = new PostgresStoryRepository(client, client);

    await expect(repository.deleteEpisode(firstEpisodeId, userId)).resolves.toBe(true);

    expect(client.transactionCalls).toBe(1);
    const advisoryIndex = client.queries.findIndex((query) => query.includes('pg_advisory_xact_lock'));
    const pageLockIndex = client.queries.findIndex(
      (query) => query.includes('FROM pages') && query.includes('FOR UPDATE'),
    );
    const blockerIndex = client.queries.findIndex((query) => query.includes('deletion_blocked'));
    const deleteIndex = client.queries.findIndex((query) => query.includes('DELETE FROM episodes'));
    expect(advisoryIndex).toBeGreaterThanOrEqual(0);
    expect(pageLockIndex).toBeGreaterThan(advisoryIndex);
    expect(blockerIndex).toBeGreaterThan(pageLockIndex);
    expect(deleteIndex).toBeGreaterThan(blockerIndex);

    const blockerQuery = client.queries[blockerIndex] ?? '';
    expect(blockerQuery).toContain("'episode_story_autofill'");
    expect(blockerQuery).toContain("'episode_page_skeleton'");
    expect(blockerQuery).toContain("'page_generate'");
    expect(blockerQuery).toContain("'queued'");
    expect(blockerQuery).toContain("'processing'");
    expect(blockerQuery).toContain('episode_export_jobs');
    expect(blockerQuery).toContain('artifact_deleted_at IS NULL');
    expect(blockerQuery).toContain('generated_image IS NOT NULL');
  });

  it('active jobまたは未削除assetがある話は409にしてDELETEを実行しない', async () => {
    const client = new DeletionClient({ blocked: true });
    const repository = new PostgresStoryRepository(client, client);

    await expect(repository.deleteEpisode(firstEpisodeId, userId)).rejects.toMatchObject({
      code: 'CONFLICT',
      statusCode: 409,
    });

    expect(client.queries.some((query) => query.includes('DELETE FROM episodes'))).toBe(false);
  });

  it('章削除はchild episode lockをID順で取得して全配下を一括検査する', async () => {
    const client = new DeletionClient({ episodeIds: [secondEpisodeId, firstEpisodeId] });
    const repository = new PostgresStoryRepository(client, client);

    await expect(repository.deleteChapter(chapterId, userId)).resolves.toBe(true);

    const advisoryIndex = client.queries.findIndex(
      (query) => query.includes('pg_advisory_xact_lock'),
    );
    const episodeLockValues = client.values[advisoryIndex]?.[1];
    expect(episodeLockValues).toEqual([
      `story:episode:${firstEpisodeId}`,
      `story:episode:${secondEpisodeId}`,
    ]);
    expect(client.queries.filter((query) => query.includes('pg_advisory_xact_lock'))).toHaveLength(1);
    expect(client.queries[advisoryIndex]).toMatch(
      /FROM ordered_locks\s+ORDER BY lock_key ASC/u,
    );
    expect(client.queries.some((query) => query.includes('DELETE FROM chapters'))).toBe(true);
  });

  it('scope外または存在しない対象はblockerを調べずnot foundとして扱う', async () => {
    const client = new DeletionClient({ found: false, blocked: true });
    const repository = new PostgresStoryRepository(client, client);

    await expect(repository.deleteEpisode(firstEpisodeId, userId)).resolves.toBe(false);

    expect(client.queries.some((query) => query.includes('pg_advisory_xact_lock'))).toBe(false);
    expect(client.queries.some((query) => query.includes('deletion_blocked'))).toBe(false);
  });
});

function resultRows<T extends QueryResultRow = QueryResultRow>(
  rows: QueryResultRow[],
  command: 'SELECT' | 'DELETE' = 'SELECT',
): QueryResult<T> {
  return {
    command,
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as T[],
  };
}
