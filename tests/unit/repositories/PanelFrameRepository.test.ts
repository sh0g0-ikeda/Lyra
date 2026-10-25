import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresPanelFrameRepository } from '../../../src/repositories/PanelFrameRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public pageStatus: 'editing' | 'confirmed' | 'generating' = 'editing';
  public queries: string[] = [];
  public transactionCount = 0;
  public values: readonly unknown[] | undefined;
  public valuesList: Array<readonly unknown[] | undefined> = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;
    this.valuesList.push(values);

    if (text.includes('FOR UPDATE OF pages')) {
      return {
        command: 'SELECT', rowCount: 1, oid: 0, fields: [],
        rows: [{ page_id: 'page-1', page_status: this.pageStatus }] as unknown as T[],
      };
    }
    if (text.includes("SET status = 'editing'")) {
      return {
        command: 'UPDATE', rowCount: 1, oid: 0, fields: [],
        rows: [{ id: 'page-1' }] as unknown as T[],
      };
    }

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [panelFrameRow()] as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }
}

describe('PostgresPanelFrameRepository', () => {
  it('legacy personal置換はusers→request→frame mutationを既存1 transactionで実行する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelFrameRepository(client, 'legacy_2debe_v1');

    await repository.replaceFramesByPageIdAndUserId('page-1', 'user-1', []);

    expect(client.transactionCount).toBe(1);
    expect(client.queries[0]).toContain('FROM users');
    expect(client.queries[1]).toContain('account_deletion_requests');
    expect(client.queries[2]).toContain('FOR UPDATE OF pages');
    expect(client.queries[3]).toContain('DELETE FROM panel_frames');
  });

  it('user_idでページ所有者を絞ってPanelFrameを取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelFrameRepository(client);

    const frames = await repository.findFramesByPageIdAndUserId('page-1', 'user-1');

    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.queries[0]).toContain('organization_members.user_id = $2');
    expect(client.queries[0]).toContain('ORDER BY panel_frames.reading_order ASC');
    expect(client.values).toEqual(['page-1', 'user-1', null]);
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

    expect(client.queries[0]).toContain('FOR UPDATE OF pages');
    expect(client.queries[1]).toContain('DELETE FROM panel_frames');
    expect(client.queries[1]).toContain('works.user_id = $2');
    expect(client.queries[2]).toContain('INSERT INTO panel_frames');
    expect(client.queries[2]).toContain('works.user_id = $10');
    expect(client.queries[2]).toContain('organization_members.user_id = $10');
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
      null,
    ]);
    expect(client.transactionCount).toBe(1);
    expect(client.queries.join('\n')).not.toContain('account_deletion_requests');
  });

  it('テンプレート適用時にlayout_configを更新する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelFrameRepository(client);

    await repository.replaceFramesByPageIdAndUserId(
      'page-1',
      'user-1',
      [
        {
          panelId: null,
          vertices: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          borderStyle: 'solid',
          borderWidth: 3,
          borderColor: '#000000',
          zIndex: 1,
          readingOrder: 1,
        },
      ],
      {
        type: 'template',
        templateId: 'splash_1',
        panelCount: 1,
        frameDefinitions: [
          {
            panelId: null,
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
            borderStyle: 'solid',
            borderWidth: 3,
            borderColor: '#000000',
            zIndex: 1,
            readingOrder: 1,
          },
        ],
      },
    );

    const layoutUpdateIndex = client.queries.findIndex((query) =>
      query.includes("COALESCE(pages.layout_config, '{}'::jsonb) - 'template_id'"),
    );
    expect(layoutUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(client.queries[layoutUpdateIndex]).toContain('layout_config');
    expect(client.queries[layoutUpdateIndex]).toContain('GREATEST(');
    expect(client.queries[layoutUpdateIndex]).toContain('works.user_id = $2');
    expect(client.valuesList[layoutUpdateIndex]).toEqual([
      'page-1',
      'user-1',
      'template',
      1,
      JSON.stringify([
        {
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
        },
      ]),
      'splash_1',
      null,
    ]);
  });

  it('手動保存時にcustomレイアウトとしてtemplate_idを残さない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelFrameRepository(client);

    await repository.replaceFramesByPageIdAndUserId(
      'page-1',
      'user-1',
      [
        {
          panelId: 'panel-1',
          vertices: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          borderStyle: 'solid',
          borderWidth: 3,
          borderColor: '#000000',
          zIndex: 1,
          readingOrder: 1,
        },
      ],
      {
        type: 'custom',
        panelCount: 1,
        frameDefinitions: [
          {
            panelId: 'panel-1',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
            borderStyle: 'solid',
            borderWidth: 3,
            borderColor: '#000000',
            zIndex: 1,
            readingOrder: 1,
          },
        ],
      },
    );

    const layoutUpdateIndex = client.queries.findIndex((query) =>
      query.includes("COALESCE(pages.layout_config, '{}'::jsonb) - 'template_id'"),
    );
    expect(client.valuesList[layoutUpdateIndex]?.slice(0, 4)).toEqual(['page-1', 'user-1', 'custom', 1]);
    expect(client.valuesList[layoutUpdateIndex]?.[5]).toBeNull();
    expect(JSON.parse(String(client.valuesList[layoutUpdateIndex]?.[4]))).toEqual([
      {
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
        panel_id: 'panel-1',
      },
    ]);
  });

  it('confirmedページのFrame保存は同じtransactionでeditingへ遷移する', async () => {
    const client = new QueryCapturingClient();
    client.pageStatus = 'confirmed';
    const repository = new PostgresPanelFrameRepository(client);

    await repository.replaceFramesByPageIdAndUserId('page-1', 'user-1', []);

    expect(client.transactionCount).toBe(1);
    expect(client.queries.some((query) => query.includes("SET status = 'editing'"))).toBe(true);
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
