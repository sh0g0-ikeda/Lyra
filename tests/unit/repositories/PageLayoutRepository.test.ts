import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresPageLayoutRepository } from '../../../src/repositories/PageLayoutRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public valuesList: Array<readonly unknown[] | undefined> = [];
  private panelListCalls = 0;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.valuesList.push(values);

    if (text.includes('FOR UPDATE OF pages')) {
      return rows<T>([{ page_id: 'page-1', page_status: 'editing' }]);
    }

    if (text.includes('FROM panels') && text.includes('FOR UPDATE')) {
      this.panelListCalls += 1;
      return rows<T>(this.panelListCalls === 1 ? panelRows(4) : panelRows(3));
    }

    if (text.includes('INSERT INTO panel_frames')) {
      return rows<T>([
        {
          id: `frame-${values?.[7] ?? 1}`,
          page_id: values?.[0],
          panel_id: values?.[1],
          vertices: JSON.parse(String(values?.[2])),
          border_style: values?.[3],
          border_width: values?.[4],
          border_color: values?.[5],
          z_index: values?.[6],
          reading_order: values?.[7],
        },
      ]);
    }

    return rows<T>([]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('PostgresPageLayoutRepository', () => {
  it('縮小テンプレートは確認なしではパネルを削除しない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageLayoutRepository(client);

    await expect(
      repository.applyTemplateAndSyncPanels('user-1', 'page-1', {
        templateId: 'top_wide_3',
        targetPanelCount: 3,
        frameDefinitions: frameDefinitions(3),
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(client.queries.some((query) => query.includes('DELETE FROM panels'))).toBe(false);
    expect(client.queries.some((query) => query.includes('DELETE FROM panel_frames'))).toBe(false);
  });

  it('縮小テンプレートは暗黙削除許可を持たず常に拒否する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageLayoutRepository(client);

    await expect(
      repository.applyTemplateAndSyncPanels('user-1', 'page-1', {
        templateId: 'top_wide_3',
        targetPanelCount: 3,
        frameDefinitions: frameDefinitions(3),
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(client.queries.some((query) => query.includes('DELETE FROM panels'))).toBe(false);
    expect(client.queries.some((query) => query.includes('DELETE FROM panel_frames'))).toBe(false);
  });
});

function rows<T extends QueryResultRow>(rowsValue: QueryResultRow[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rowsValue.length,
    oid: 0,
    fields: [],
    rows: rowsValue as T[],
  };
}

function panelRows(count: number): QueryResultRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `panel-${index + 1}`,
    order: index + 1,
  }));
}

function frameDefinitions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    panelId: null,
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    borderStyle: 'solid' as const,
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: 1,
    readingOrder: index + 1,
  }));
}
