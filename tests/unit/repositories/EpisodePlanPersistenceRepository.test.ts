import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresEpisodePlanPersistenceRepository } from '../../../src/repositories/EpisodePlanPersistenceRepository.js';

class LockCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public values: Array<readonly unknown[] | undefined> = [];

  public constructor(private readonly authorizeEpisode: boolean) {}

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);
    const isAuthorizationLock = text.includes('FOR UPDATE OF works, chapters, episodes');
    const rows = isAuthorizationLock && this.authorizeEpisode
      ? [{ episode_id: 'episode-1' }]
      : [];
    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[],
    };
  }
}

describe('PostgresEpisodePlanPersistenceRepository', () => {
  it('対象の話にアクセスできない場合はロックも保存も行わない', async () => {
    const client = new LockCapturingClient(false);
    const repository = new PostgresEpisodePlanPersistenceRepository(client);

    await expect(repository.withLockedEpisodePlan(
      {
        episodeId: 'episode-1',
        userId: 'user-1',
        organizationId: '11111111-1111-4111-8111-111111111111',
      },
      async () => undefined,
    )).rejects.toBeInstanceOf(NotFoundError);

    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain("organization_members.status = 'active'");
  });

  it('確定前に話からキャラ状態までを一定順序でロックする', async () => {
    const client = new LockCapturingClient(true);
    const repository = new PostgresEpisodePlanPersistenceRepository(client);

    await expect(repository.withLockedEpisodePlan(
      { episodeId: 'episode-1', userId: 'user-1', organizationId: null },
      async () => undefined,
    )).rejects.toBeInstanceOf(NotFoundError);

    expect(client.queries.slice(0, 7).map((query) => {
      if (query.includes('FOR UPDATE OF works, chapters, episodes')) return 'episode';
      if (query.includes('FROM scenes')) return 'scenes';
      if (query.includes('FROM pages') && !query.includes('INNER JOIN')) return 'pages';
      if (query.includes('FROM panels')) return 'panels';
      if (query.includes('FROM panel_frames')) return 'frames';
      if (query.includes('FROM entities')) return 'entities';
      if (query.includes('FROM entity_states')) return 'entity_states';
      return 'unknown';
    })).toEqual([
      'episode',
      'scenes',
      'pages',
      'panels',
      'frames',
      'entities',
      'entity_states',
    ]);
  });
});
