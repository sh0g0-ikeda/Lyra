import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresBalloonRepository } from '../../../src/repositories/BalloonRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public values: readonly unknown[] | undefined;
  public valuesList: Array<readonly unknown[] | undefined> = [];
  public currentPanelIds = ['panel-1', 'panel-2', 'panel-3'];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;
    this.valuesList.push(values);

    if (text.includes('FOR UPDATE OF pages')) {
      return resultRows<T>([row()]);
    }

    if (text.includes('SELECT panels.id') && text.includes('FOR KEY SHARE')) {
      return resultRows<T>(this.currentPanelIds.map((id) => ({ id })));
    }

    if (text.includes('SELECT balloons.page_id AS page_id')) {
      return resultRows<T>([{ page_id: 'page-1' }]);
    }

    if (text.includes('DELETE FROM balloons')) {
      return resultRows<T>([]);
    }

    return resultRows<T>([row()]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('PostgresBalloonRepository', () => {
  it('page context 取得は works.user_id で所有権を絞る', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    await repository.findPageContextByIdAndUserId('page-1', 'user-1');

    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.values).toEqual(['page-1', 'user-1', null]);
  });

  it('法人 page context 取得は organization_id と active member で絞る', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    await repository.findPageContextByIdAndUserId('page-1', 'user-1', 'org-1');

    expect(client.queries[0]).toContain('works.organization_id = $3::uuid');
    expect(client.queries[0]).toContain('organization_members.status =');
    expect(client.values).toEqual(['page-1', 'user-1', 'org-1']);
  });

  it('page context に status と panel_count を含める', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    const context = await repository.findPageContextByIdAndUserId('page-1', 'user-1');

    expect(context).toMatchObject({
      status: 'editing',
      panelCount: 3,
    });
  });

  it('balloon 作成は works.user_id で所有権を絞る', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    await repository.createBalloon('page-1', 'user-1', {
      speakerEntityId: null,
      balloonType: 'speech',
      writingMode: 'vertical',
      text: 'hello',
      position: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
      tail: null,
      fontSize: 18,
      fontFamily: 'manga_gothic',
      panelOrderReference: 1,
      zIndex: 10,
    });

    const insertIndex = client.queries.findIndex((query) => query.includes('INSERT INTO balloons'));
    expect(client.queries[insertIndex]).toContain('FROM pages');
    expect(client.queries[insertIndex]).toContain('works.user_id = $2');
    expect(client.valuesList[insertIndex]).toEqual([
      'page-1',
      'user-1',
      null,
      'speech',
      'vertical',
      'hello',
      JSON.stringify({
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.2,
      }),
      JSON.stringify(null),
      18,
      'manga_gothic',
      1,
      10,
      null,
    ]);
  });

  it('balloon 更新は tail を snake_case で保存する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    await repository.updateBalloon('balloon-1', 'user-1', {
      tail: {
        baseX: 0.2,
        baseY: 0.3,
        tipX: 0.4,
        tipY: 0.5,
      },
    });

    const updateIndex = client.queries.findIndex((query) => query.includes('UPDATE balloons'));
    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(client.valuesList[updateIndex]?.[10]).toBe(
      JSON.stringify({
        base_x: 0.2,
        base_y: 0.3,
        tip_x: 0.4,
        tip_y: 0.5,
      }),
    );
  });

  it('tail は snake_case の既存データも読み戻せる', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    const balloons = await repository.findBalloonsByPageIdAndUserId('page-1', 'user-1');

    expect(balloons[0]?.tail).toEqual({
      baseX: 0.2,
      baseY: 0.3,
      tipX: 0.4,
      tipY: 0.5,
    });
  });

  it('auto-balloons 置換は delete 後に insert を積む', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    const balloons = await repository.replaceBalloonsByPageIdAndUserId('page-1', 'user-1', [
      {
        speakerEntityId: 'entity-1',
        balloonType: 'speech',
        writingMode: 'vertical',
        text: 'hello',
        position: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
        tail: { baseX: 0.2, baseY: 0.3, tipX: 0.4, tipY: 0.5 },
        fontSize: 18,
        fontFamily: 'manga_gothic',
        panelOrderReference: 1,
        zIndex: 10,
      },
    ]);

    const deleteIndex = client.queries.findIndex((query) => query.includes('DELETE FROM balloons'));
    const insertIndex = client.queries.findIndex((query) => query.includes('INSERT INTO balloons'));
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(deleteIndex);
    expect(client.valuesList[insertIndex]).toEqual([
      'page-1',
      'user-1',
      'entity-1',
      'speech',
      'vertical',
      'hello',
      JSON.stringify({
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.2,
      }),
      JSON.stringify({
        base_x: 0.2,
        base_y: 0.3,
        tip_x: 0.4,
        tip_y: 0.5,
      }),
      18,
      'manga_gothic',
      1,
      10,
      null,
    ]);
    expect(balloons).toHaveLength(1);
  });

  it('作成前のPanel ID順が変わった場合にPage lock後かつINSERT前に拒否する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    await expect(repository.createBalloon('page-1', 'user-1', createInput(1), null, [
      'panel-2',
      'panel-1',
      'panel-3',
    ])).rejects.toBeInstanceOf(ConflictError);

    expect(client.queries.some((query) => query.includes('FOR UPDATE OF pages'))).toBe(true);
    expect(client.queries.some((query) => query.includes('INSERT INTO balloons'))).toBe(false);
  });

  it('更新前のPanel ID順が変わった場合にUPDATEしない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    await expect(repository.updateBalloon(
      'balloon-1',
      'user-1',
      { panelOrderReference: 2 },
      null,
      ['panel-2', 'panel-1', 'panel-3'],
    )).rejects.toBeInstanceOf(ConflictError);

    expect(client.queries.some((query) => query.includes('UPDATE balloons'))).toBe(false);
  });

  it('自動配置前のPanel ID順が変わった場合に既存BalloonをDELETEしない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    await expect(repository.replaceBalloonsByPageIdAndUserId(
      'page-1',
      'user-1',
      [createInput(1)],
      null,
      ['panel-2', 'panel-1', 'panel-3'],
    )).rejects.toBeInstanceOf(ConflictError);

    expect(client.queries.some((query) => query.includes('DELETE FROM balloons'))).toBe(false);
  });
});

function createInput(panelOrderReference: number) {
  return {
    speakerEntityId: null,
    balloonType: 'speech' as const,
    writingMode: 'vertical' as const,
    text: 'hello',
    position: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
    tail: null,
    fontSize: 18,
    fontFamily: 'manga_gothic' as const,
    panelOrderReference,
    zIndex: 10,
  };
}

function resultRows<T extends QueryResultRow>(rows: QueryResultRow[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as T[],
  };
}

function row(): Record<string, unknown> {
  return {
    balloon_id: 'balloon-1',
    id: 'balloon-1',
    page_id: 'page-1',
    work_id: 'work-1',
    status: 'editing',
    dialogue_mode: 'mixed',
    generated_image: {
      s3_key: 'session/user-1/pages/page-1/image.png',
      cdn_url: 'https://cdn.lyra.test/page-1.png',
      generation_mode: 'standard',
      generated_at: '2026-04-24T00:00:00.000Z',
    },
    panel_count: 3,
    speaker_entity_id: null,
    balloon_type: 'speech',
    writing_mode: 'vertical',
    text: 'hello',
    position: {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.2,
    },
    tail: {
      base_x: 0.2,
      base_y: 0.3,
      tip_x: 0.4,
      tip_y: 0.5,
    },
    font_size: 18,
    font_family: 'manga_gothic',
    panel_order_reference: 1,
    z_index: 10,
  };
}
