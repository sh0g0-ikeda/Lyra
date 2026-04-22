import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresStoryRepository } from '../../../src/repositories/StoryRepository.js';

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
      rows: [workRow()] as T[],
    };
  }
}

class UniqueViolationClient implements DatabaseClient {
  public async query<T extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<T>> {
    throw {
      code: '23505',
      constraint: 'chapters_work_id_order_key',
    };
  }
}

describe('PostgresStoryRepository', () => {
  it('作品更新の場合にedit_historyへ更新前スナップショットを積むSQLになる', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStoryRepository(client);

    await repository.updateWork('11111111-1111-4111-8111-111111111111', 'user-1', {
      title: '黒月の騎士 改',
    });

    expect(client.queries[0]).toContain('edit_history');
    expect(client.queries[0]).toContain('jsonb_build_object');
    expect(client.queries[0]).toContain('LIMIT 5');
  });

  it('章order重複の場合にVALIDATION_ERRORになる', async () => {
    const repository = new PostgresStoryRepository(new UniqueViolationClient());

    await expect(
      repository.createChapter('11111111-1111-4111-8111-111111111111', {
        order: 1,
        title: '第一章',
        purpose: null,
        startingState: null,
        endingState: null,
        emotionCurve: null,
        entitiesInvolved: [],
        keyBeats: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

function workRow(): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user-1',
    title: '黒月の騎士',
    genre: null,
    world_setting: null,
    theme: null,
    main_entity_ids: [],
    starting_point: null,
    ending_point: null,
    overall_flow: null,
    version: 2,
    edit_history: [],
    status: 'draft',
    created_at: new Date('2026-04-22T00:00:00.000Z'),
    updated_at: new Date('2026-04-22T00:00:00.000Z'),
  };
}
