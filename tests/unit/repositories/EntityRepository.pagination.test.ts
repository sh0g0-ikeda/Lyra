import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import {
  PostgresEntityRepository,
  type EntityListCursor,
} from '../../../src/repositories/EntityRepository.js';

const workId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';

describe('PostgresEntityRepository pagination', () => {
  it('work・personal scopeを既存順・ID tie-breaker・limit+1で取得する', async () => {
    const client = new EntityPageClient();
    const repository = new PostgresEntityRepository(client);

    const page = await repository.findPageByWorkIdAndUserId(
      workId,
      userId,
      { limit: 2, cursor: null },
      null,
    );

    expect(client.sql).toContain('entities.work_id = $1::uuid');
    expect(client.sql).toContain('entities.user_id = $2::uuid');
    expect(client.sql).toContain('works.organization_id IS NULL');
    expect(client.sql).toContain(
      'ORDER BY entities.created_at DESC, entities.id DESC',
    );
    expect(client.values).toEqual([workId, userId, null, null, null, 3]);
    expect(page.entities).toHaveLength(2);
    expect(page.nextCursor).toEqual({
      createdAt: new Date('2026-07-30T00:00:00.000Z'),
      id: entityId(2),
    });
  });

  it('organization scopeをactive memberに限定してcursorを渡す', async () => {
    const client = new EntityPageClient();
    const repository = new PostgresEntityRepository(client);
    const cursor: EntityListCursor = {
      createdAt: new Date('2026-07-30T00:00:00.000Z'),
      id: entityId(2),
    };

    await repository.findPageByWorkIdAndUserId(
      workId,
      userId,
      { limit: 25, cursor },
      organizationId,
    );

    expect(client.sql).toContain('works.organization_id = $3::uuid');
    expect(client.sql).toContain('FROM organization_members');
    expect(client.sql).toContain('organization_members.user_id = $2::uuid');
    expect(client.sql).toContain("organization_members.status = 'active'");
    expect(client.values).toEqual([
      workId,
      userId,
      organizationId,
      cursor.createdAt,
      cursor.id,
      26,
    ]);
  });
});

class EntityPageClient implements DatabaseClient {
  public sql = '';
  public values: readonly unknown[] | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.sql = text;
    this.values = values;
    return queryResult([
      entityRow(entityId(1), '2026-07-31T00:00:00.000Z'),
      entityRow(entityId(2), '2026-07-30T00:00:00.000Z'),
      entityRow(entityId(3), '2026-07-29T00:00:00.000Z'),
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

function entityRow(id: string, createdAt: string): QueryResultRow {
  return {
    id,
    work_id: workId,
    user_id: userId,
    entity_type: 'character',
    name: 'ミヅキ',
    free_description: null,
    structured_fields: {},
    prompt_supplement: null,
    speech_profile: {},
    status: 'draft',
    created_at: new Date(createdAt),
    updated_at: new Date(createdAt),
  };
}

function entityId(value: number): string {
  return `${String(value).padStart(8, '0')}-2222-4222-8222-222222222222`;
}
