import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresCompositionGalleryRepository } from '../../../src/repositories/CompositionGalleryRepository.js';

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
      rows: [compositionRow()] as T[],
    };
  }
}

describe('PostgresCompositionGalleryRepository', () => {
  it('検索条件をパラメータで渡して構図を取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresCompositionGalleryRepository(client);

    const compositions = await repository.findMany({
      category: 'battle',
      entityCount: 2,
      tag: 'action',
      limit: 50,
    });

    expect(client.queries[0]).toContain('category = COALESCE($1, category)');
    expect(client.queries[0]).toContain('$3::text IS NULL OR $3 = ANY(tags)');
    expect(client.values).toEqual(['battle', 2, 'action', 50]);
    expect(compositions[0]).toMatchObject({
      id: 'battle_single_001',
      entityCount: 1,
      tags: ['battle', 'action'],
    });
  });
});

function compositionRow(): Record<string, unknown> {
  return {
    id: 'battle_single_001',
    name: 'Battle Single',
    category: 'battle',
    entity_count: 1,
    preview_s3_key: 'composition/battle_single_001.png',
    preview_cdn_url: 'https://img.lyra.app/composition/battle_single_001.png',
    composition_prompt: 'single character, full body, battle stance',
    shot_type: 'full_body',
    angle: 'front',
    tags: ['battle', 'action'],
    created_at: new Date('2026-04-22T00:00:00.000Z'),
  };
}
