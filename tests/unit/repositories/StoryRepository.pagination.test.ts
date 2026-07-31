import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import {
  PostgresStoryRepository,
  type WorkListCursor,
} from '../../../src/repositories/StoryRepository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';

describe('PostgresStoryRepository work pagination', () => {
  it('personal scopeを既存順・ID tie-breaker・limit+1で取得する', async () => {
    const client = new WorkPageClient();
    const repository = new PostgresStoryRepository(client);

    const page = await repository.findWorksPageByUserId(
      userId,
      { limit: 2, cursor: null },
      null,
    );

    expect(client.sql).toContain('works.user_id = $1::uuid');
    expect(client.sql).toContain('works.organization_id IS NULL');
    expect(client.sql).toContain(
      'ORDER BY works.updated_at DESC, works.created_at DESC, works.id DESC',
    );
    expect(client.values).toEqual([userId, null, null, null, null, 3]);
    expect(page.works).toHaveLength(2);
    expect(page.nextCursor).toEqual({
      updatedAt: new Date('2026-07-30T00:00:00.000Z'),
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      id: workId(2),
    });
  });

  it('organization scopeをactive memberに限定してcursorを渡す', async () => {
    const client = new WorkPageClient();
    const repository = new PostgresStoryRepository(client);
    const cursor: WorkListCursor = {
      updatedAt: new Date('2026-07-30T00:00:00.000Z'),
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      id: workId(2),
    };

    await repository.findWorksPageByUserId(
      userId,
      { limit: 25, cursor },
      organizationId,
    );

    expect(client.sql).toContain('works.organization_id = $2::uuid');
    expect(client.sql).toContain('FROM organization_members');
    expect(client.sql).toContain('organization_members.user_id = $1::uuid');
    expect(client.sql).toContain("organization_members.status = 'active'");
    expect(client.values).toEqual([
      userId,
      organizationId,
      cursor.updatedAt,
      cursor.createdAt,
      cursor.id,
      26,
    ]);
  });
});

class WorkPageClient implements DatabaseClient {
  public sql = '';
  public values: readonly unknown[] | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.sql = text;
    this.values = values;
    return queryResult([
      workRow(workId(1), '2026-07-31T00:00:00.000Z', '2026-07-30T00:00:00.000Z'),
      workRow(workId(2), '2026-07-30T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
      workRow(workId(3), '2026-07-29T00:00:00.000Z', '2026-07-28T00:00:00.000Z'),
    ]) as QueryResult<T>;
  }
}

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function workRow(id: string, updatedAt: string, createdAt: string): QueryResultRow {
  return {
    id,
    user_id: userId,
    organization_id: null,
    title: '作品',
    genre: null,
    world_setting: null,
    theme: null,
    main_entity_ids: [],
    starting_point: null,
    ending_point: null,
    overall_flow: null,
    version: 1,
    edit_history: [],
    status: 'draft',
    created_at: new Date(createdAt),
    updated_at: new Date(updatedAt),
  };
}

function workId(value: number): string {
  return `${String(value).padStart(8, '0')}-1111-4111-8111-111111111111`;
}
