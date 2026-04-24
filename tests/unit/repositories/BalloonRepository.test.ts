import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresBalloonRepository } from '../../../src/repositories/BalloonRepository.js';

class QueryCapturingClient implements DatabaseClient {
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
      rows: [balloonRow()] as unknown as T[],
    };
  }
}

describe('PostgresBalloonRepository', () => {
  it('page context 取得は works.user_id で所有権を絞る', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBalloonRepository(client);

    await repository.findPageContextByIdAndUserId('page-1', 'user-1');

    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.values).toEqual(['page-1', 'user-1']);
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

    expect(client.queries[0]).toContain('UPDATE balloons');
    expect(client.values?.[10]).toBe(JSON.stringify({
      base_x: 0.2,
      base_y: 0.3,
      tip_x: 0.4,
      tip_y: 0.5,
    }));
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
});

function balloonRow(): Record<string, unknown> {
  return {
    id: 'balloon-1',
    page_id: 'page-1',
    speaker_entity_id: null,
    balloon_type: 'speech',
    writing_mode: 'vertical',
    text: 'こんにちは',
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
