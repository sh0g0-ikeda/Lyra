import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import {
  PostgresPagePanelStructureRepository,
  type ApplyPagePanelStructureInput,
} from '../../../src/repositories/PagePanelStructureRepository.js';

const p1 = '11111111-1111-4111-8111-111111111111';
const p2 = '22222222-2222-4222-8222-222222222222';
const p3 = '33333333-3333-4333-8333-333333333333';
const createdPanelId = '44444444-4444-4444-8444-444444444444';

class StructureQueryClient implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];
  public readonly valuesList: Array<readonly unknown[] | undefined> = [];
  public currentPanelIds: string[] = [p1, p2];
  public activeJob = false;
  public balloonUpdatedCount = 0;
  public balloonClearedCount = 0;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.valuesList.push(values);

    if (text.includes('pages.episode_id AS episode_id')) {
      return rows<T>([{ episode_id: 'episode-1', page_status: 'editing' }]);
    }
    if (text.includes('AS has_active_job')) {
      return rows<T>([{ has_active_job: this.activeJob }]);
    }
    if (text.includes('FROM panels') && text.includes('FOR UPDATE')) {
      return rows<T>(this.currentPanelIds.map((id, index) => ({ id, order: index + 1 })));
    }
    if (text.includes('INSERT INTO panels')) {
      return rows<T>([{ id: createdPanelId }]);
    }
    if (text.includes('DELETE FROM panels')) {
      return rows<T>([{ id: values?.[1] }]);
    }
    if (text.includes('FROM panel_frames') && text.includes('FOR UPDATE')) {
      return rows<T>(this.currentPanelIds.map((id, index) => frameRow(index + 1, id)));
    }
    if (text.includes('UPDATE panel_frames') && text.includes('requested_order')) {
      const panelIds = values?.[1] as string[];
      return rows<T>(panelIds.map((id, index) => frameRow(index + 1, id)));
    }
    if (text.includes('INSERT INTO panel_frames')) {
      return rows<T>([{
        id: `frame-${values?.[7]}`,
        page_id: values?.[0],
        panel_id: values?.[1],
        vertices: JSON.parse(String(values?.[2])),
        border_style: values?.[3],
        border_width: values?.[4],
        border_color: values?.[5],
        z_index: values?.[6],
        reading_order: values?.[7],
      }]);
    }
    if (text.includes('balloon_reference_updated_count')) {
      return rows<T>([{
        balloon_reference_updated_count: String(this.balloonUpdatedCount),
        balloon_reference_cleared_count: String(this.balloonClearedCount),
      }]);
    }
    return rows<T>([]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('PostgresPagePanelStructureRepository', () => {
  it('保存前のPanel順が変わっている場合に一切更新しない', async () => {
    const client = new StructureQueryClient();
    const repository = new PostgresPagePanelStructureRepository(client);

    await expect(repository.apply('user-1', 'page-1', {
      expectedPanelIds: [p2, p1],
      operation: { type: 'reorder', panelIds: [p1, p2] },
      replacementLayout: null,
    })).rejects.toBeInstanceOf(ConflictError);

    expect(client.queries.some(isMutationQuery)).toBe(false);
  });

  it('対象PageまたはEpisodeに生成中ジョブがある場合に一切更新しない', async () => {
    const client = new StructureQueryClient();
    client.activeJob = true;
    const repository = new PostgresPagePanelStructureRepository(client);

    await expect(repository.apply('user-1', 'page-1', appendInput([p1, p2]))).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(client.queries.some(isMutationQuery)).toBe(false);
  });

  it('追加の場合にEpisode admission lock後の同一transactionでPanelと既定Frameを保存する', async () => {
    const client = new StructureQueryClient();
    client.currentPanelIds = [p1];
    const repository = new PostgresPagePanelStructureRepository(client);

    const result = await repository.apply('user-1', 'page-1', appendInput([p1]));

    expect(result).toMatchObject({
      panelIds: [p1, createdPanelId],
      createdPanelId,
      layoutTemplateId: 'climax_2',
      balloonReferenceUpdatedCount: 0,
      balloonReferenceClearedCount: 0,
    });
    expect(result.frames.map((frame) => frame.panelId)).toEqual([p1, createdPanelId]);
    const admissionLockIndex = client.queries.findIndex((query) => query.includes('pg_advisory_xact_lock'));
    const pageLockIndex = client.queries.findIndex((query) => query.includes('FOR UPDATE OF pages'));
    const panelInsertIndex = client.queries.findIndex((query) => query.includes('INSERT INTO panels'));
    expect(admissionLockIndex).toBeGreaterThanOrEqual(0);
    expect(pageLockIndex).toBeGreaterThan(admissionLockIndex);
    expect(panelInsertIndex).toBeGreaterThan(pageLockIndex);
    expect(client.queries.filter((query) => query.includes('INSERT INTO panel_frames'))).toHaveLength(2);
  });

  it('削除の場合に同じPanelを指す吹き出しだけ解除し後続参照を詰める', async () => {
    const client = new StructureQueryClient();
    client.currentPanelIds = [p1, p2, p3];
    client.balloonUpdatedCount = 3;
    client.balloonClearedCount = 1;
    const repository = new PostgresPagePanelStructureRepository(client);

    const result = await repository.apply('user-1', 'page-1', {
      expectedPanelIds: [p1, p2, p3],
      operation: { type: 'delete', panelId: p2 },
      replacementLayout: {
        templateId: 'climax_2',
        frameDefinitions: frameDefinitions(2),
      },
    });

    expect(result).toMatchObject({
      panelIds: [p1, p3],
      balloonReferenceUpdatedCount: 3,
      balloonReferenceClearedCount: 1,
    });
    expect(result.frames.map((frame) => frame.panelId)).toEqual([p1, p3]);
    expect(client.queries.some((query) => query.includes('DELETE FROM panels'))).toBe(true);
  });

  it('並び替えの場合にFrame形状を作り直さずPanelリンクと吹き出し参照を追従させる', async () => {
    const client = new StructureQueryClient();
    client.balloonUpdatedCount = 2;
    const repository = new PostgresPagePanelStructureRepository(client);

    const result = await repository.apply('user-1', 'page-1', {
      expectedPanelIds: [p1, p2],
      operation: { type: 'reorder', panelIds: [p2, p1] },
      replacementLayout: null,
    });

    expect(result).toMatchObject({
      panelIds: [p2, p1],
      createdPanelId: null,
      layoutTemplateId: null,
      balloonReferenceUpdatedCount: 2,
    });
    expect(result.frames.map((frame) => frame.panelId)).toEqual([p2, p1]);
    expect(client.queries.some((query) => query.includes('DELETE FROM panel_frames'))).toBe(false);
    expect(client.queries.some((query) => query.includes('INSERT INTO panel_frames'))).toBe(false);
  });
});

function appendInput(expectedPanelIds: string[]): ApplyPagePanelStructureInput {
  const targetCount = expectedPanelIds.length + 1;
  const templateId = targetCount === 2 ? 'climax_2' : 'top_wide_3';
  return {
    expectedPanelIds,
    operation: { type: 'append' },
    replacementLayout: {
      templateId,
      frameDefinitions: frameDefinitions(targetCount),
    },
  };
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

function frameRow(readingOrder: number, panelId: string): QueryResultRow {
  return {
    id: `frame-${readingOrder}`,
    page_id: 'page-1',
    panel_id: panelId,
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ],
    border_style: 'solid',
    border_width: 3,
    border_color: '#000000',
    z_index: 1,
    reading_order: readingOrder,
  };
}

function rows<T extends QueryResultRow>(rowValues: QueryResultRow[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rowValues.length,
    oid: 0,
    fields: [],
    rows: rowValues as T[],
  };
}

function isMutationQuery(query: string): boolean {
  return /^\s*(?:INSERT|UPDATE|DELETE)\b/u.test(query);
}
