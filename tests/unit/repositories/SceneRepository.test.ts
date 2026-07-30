import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresSceneRepository } from '../../../src/repositories/SceneRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public queries: string[] = [];

  public constructor(private readonly row: Record<string, unknown>) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [this.row] as T[],
    };
  }
}

class UniqueViolationClient implements DatabaseClient {
  public async query<T extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<T>> {
    throw {
      code: '23505',
      constraint: 'scenes_episode_id_order_key',
    };
  }
}

describe('PostgresSceneRepository', () => {
  it('Scene一覧取得SQLがworks.user_idで絞る', async () => {
    const client = new QueryCapturingClient(sceneRow());
    const repository = new PostgresSceneRepository(client);

    await repository.findScenesByEpisodeIdAndUserId(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
    );

    expect(client.queries[0]).toContain('works.user_id = $2');
  });

  it('entity_state更新SQLがentities.user_idで絞る', async () => {
    const client = new QueryCapturingClient(entityStateRow());
    const repository = new PostgresSceneRepository(client);

    await repository.updateEntityState(
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
      'user-1',
      { costumeNote: '黒のタクティカルスーツ' },
    );

    expect(client.queries[0]).toContain('entities.user_id = $3');
  });

  it('Sceneのorder重複の場合にVALIDATION_ERRORになる', async () => {
    const repository = new PostgresSceneRepository(new UniqueViolationClient());

    await expect(
      repository.createScene('33333333-3333-4333-8333-333333333333', {
        order: 1,
        location: null,
        time: null,
        atmosphere: null,
        involvedEntityIds: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('Entity state一覧をpersonalとactive organization membershipでscopeして安定順に返す', async () => {
    const client = new QueryCapturingClient(entityStateRow());
    const repository = new PostgresSceneRepository(client);

    const states = await repository.findEntityStatesByEntityIdAndUserId(
      '55555555-5555-4555-8555-555555555555',
      'user-1',
      '77777777-7777-4777-8777-777777777777',
    );

    expect(states).toHaveLength(1);
    expect(client.queries[0]).toContain('works.organization_id IS NULL AND entities.user_id = $2');
    expect(client.queries[0]).toContain("organization_members.status = 'active'");
    expect(client.queries[0]).toContain('ORDER BY entity_states.created_at ASC, entity_states.id ASC');
  });
});

function sceneRow(): Record<string, unknown> {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    episode_id: '33333333-3333-4333-8333-333333333333',
    order: 1,
    location: '廃墟の広場',
    time: '夜',
    atmosphere: 'tense',
    involved_entity_ids: [],
    entity_states: [],
    status: 'draft',
    created_at: new Date('2026-04-22T00:00:00.000Z'),
    updated_at: new Date('2026-04-22T00:00:00.000Z'),
  };
}

function entityStateRow(): Record<string, unknown> {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    entity_id: '55555555-5555-4555-8555-555555555555',
    scene_id: null,
    costume_note: '黒のタクティカルスーツ',
    costume_ref_id: null,
    condition_note: null,
    hair_note: null,
    expression_default: 'neutral',
    extra_note: null,
    created_at: new Date('2026-04-22T00:00:00.000Z'),
  };
}
