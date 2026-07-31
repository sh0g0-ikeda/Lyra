import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import {
  PostgresPageRepository,
  type PageListCursor,
} from '../../../src/repositories/PageRepository.js';

const episodeId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';

describe('PostgresPageRepository pagination', () => {
  it('episode・personal scopeをページ番号順・limit+1で取得する', async () => {
    const client = new PageListClient();
    const repository = new PostgresPageRepository(client);

    const page = await repository.findPagesPageByEpisodeIdAndUserId(
      episodeId,
      userId,
      { limit: 2, cursor: null },
      null,
    );

    expect(client.sql).toContain('pages.episode_id = $1::uuid');
    expect(client.sql).toContain('works.user_id = $2::uuid');
    expect(client.sql).toContain('works.organization_id IS NULL');
    expect(client.sql).toContain('GROUP BY pages.id');
    expect(client.sql).toContain(
      'ORDER BY pages.page_number ASC, pages.id ASC',
    );
    expect(client.values).toEqual([episodeId, userId, null, null, null, 3]);
    expect(page.pages).toHaveLength(2);
    expect(page.nextCursor).toEqual({
      pageNumber: 2,
      id: pageId(2),
    });
  });

  it('organization scopeをactive memberに限定してcursorを渡す', async () => {
    const client = new PageListClient();
    const repository = new PostgresPageRepository(client);
    const cursor: PageListCursor = {
      pageNumber: 2,
      id: pageId(2),
    };

    await repository.findPagesPageByEpisodeIdAndUserId(
      episodeId,
      userId,
      { limit: 25, cursor },
      organizationId,
    );

    expect(client.sql).toContain('works.organization_id = $3::uuid');
    expect(client.sql).toContain('FROM organization_members');
    expect(client.sql).toContain('organization_members.user_id = $2::uuid');
    expect(client.sql).toContain("organization_members.status = 'active'");
    expect(client.values).toEqual([
      episodeId,
      userId,
      organizationId,
      cursor.pageNumber,
      cursor.id,
      26,
    ]);
  });
});

class PageListClient implements DatabaseClient {
  public sql = '';
  public values: readonly unknown[] | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.sql = text;
    this.values = values;
    return queryResult([
      pageRow(pageId(1), 1),
      pageRow(pageId(2), 2),
      pageRow(pageId(3), 3),
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

function pageRow(id: string, pageNumber: number): QueryResultRow {
  return {
    id,
    episode_id: episodeId,
    page_number: pageNumber,
    layout_config: {},
    dialogue_mode: 'mixed',
    page_dialogue_toggle: true,
    generation_mode: null,
    generated_image: null,
    status: 'designing',
    panel_count: 0,
    frame_count: 0,
    balloon_count: 0,
    created_at: new Date('2026-07-31T00:00:00.000Z'),
    updated_at: new Date('2026-07-31T00:00:00.000Z'),
  };
}

function pageId(value: number): string {
  return `${String(value).padStart(8, '0')}-3333-4333-8333-333333333333`;
}
