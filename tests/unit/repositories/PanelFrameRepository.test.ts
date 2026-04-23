import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresPanelFrameRepository } from '../../../src/repositories/PanelFrameRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public values: readonly unknown[] | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [panelFrameRow()] as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('PostgresPanelFrameRepository', () => {
  it('user_idでページ所有者を絞ってPanelFrameを取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelFrameRepository(client);

    const frames = await repository.findFramesByPageIdAndUserId('page-1', 'user-1');

    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.queries[0]).toContain('ORDER BY panel_frames.reading_order ASC');
    expect(client.values).toEqual(['page-1', 'user-1']);
    expect(frames[0]).toMatchObject({
      id: 'frame-1',
      pageId: 'page-1',
      panelId: 'panel-1',
      readingOrder: 1,
    });
  });

  it('既存Frameを削除してから新しいFrameを挿入する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelFrameRepository(client);

    await repository.replaceFramesByPageIdAndUserId('page-1', 'user-1', [
      {
        panelId: 'panel-1',
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        borderStyle: 'dashed',
        borderWidth: 2,
        borderColor: '#111111',
        zIndex: 2,
        readingOrder: 1,
      },
    ]);

    expect(client.queries[0]).toContain('DELETE FROM panel_frames');
    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.queries[1]).toContain('INSERT INTO panel_frames');
    expect(client.queries[1]).toContain('works.user_id = $10');
    expect(client.values).toEqual([
      null,
      'page-1',
      'panel-1',
      JSON.stringify([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
      'dashed',
      2,
      '#111111',
      2,
      1,
      'user-1',
    ]);
  });
});

function panelFrameRow(): Record<string, unknown> {
  return {
    id: 'frame-1',
    page_id: 'page-1',
    panel_id: 'panel-1',
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    border_style: 'solid',
    border_width: 3,
    border_color: '#000000',
    z_index: 1,
    reading_order: 1,
  };
}
