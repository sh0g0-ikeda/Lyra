import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresPanelEntityAssignmentRepository } from '../../../src/repositories/PanelEntityAssignmentRepository.js';

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
      rows: [panelRow()] as T[],
    };
  }
}

describe('PostgresPanelEntityAssignmentRepository', () => {
  it('user_idでPanel所有者を絞ってcontextを取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelEntityAssignmentRepository(client);

    const context = await repository.findPanelContextByIdAndUserId('panel-1', 'user-1');

    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.values).toEqual(['panel-1', 'user-1']);
    expect(context).toEqual({ panelId: 'panel-1', pageId: 'page-1', workId: 'work-1' });
  });

  it('同一work内のentity数を数える', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelEntityAssignmentRepository(client);

    await repository.countEntitiesByIdsAndWorkIdAndUserId(['entity-1'], 'work-1', 'user-1');

    expect(client.queries[0]).toContain('COUNT(DISTINCT id)::int AS count');
    expect(client.queries[0]).toContain('work_id = $2');
    expect(client.values).toEqual([['entity-1'], 'work-1', 'user-1']);
  });

  it('entity_stateが指定entityと同一workに属する数を数える', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelEntityAssignmentRepository(client);

    await repository.countEntityStatePairsByWorkIdAndUserId(
      [{ entityId: 'entity-1', stateId: 'state-1' }],
      'work-1',
      'user-1',
    );

    expect(client.queries[0]).toContain('jsonb_to_recordset($1::jsonb)');
    expect(client.queries[0]).toContain('entity_states.entity_id = requested.entity_id');
    expect(client.queries[0]).toContain('entities.work_id = $2');
    expect(client.values).toEqual([
      JSON.stringify([{ entity_id: 'entity-1', state_id: 'state-1' }]),
      'work-1',
      'user-1',
    ]);
  });

  it('panel所有者を絞ってentities JSONBを更新する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelEntityAssignmentRepository(client);

    const assignments = await repository.updatePanelEntityAssignments('panel-1', 'user-1', [
      {
        entityId: 'entity-1',
        role: 'primary',
        expression: 'determined',
        customExpression: null,
        action: 'attacking',
        customAction: null,
        position: 'center',
        stateId: 'state-1',
      },
    ]);

    expect(client.queries[0]).toContain('UPDATE panels');
    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.values).toEqual([
      'panel-1',
      'user-1',
      JSON.stringify([
        {
          entity_id: 'entity-1',
          role: 'primary',
          expression: 'determined',
          custom_expression: null,
          action: 'attacking',
          custom_action: null,
          position: 'center',
          state_id: 'state-1',
        },
      ]),
    ]);
    expect(assignments?.[0]).toMatchObject({ entityId: 'entity-1', stateId: 'state-1' });
  });
});

function panelRow(): Record<string, unknown> {
  return {
    panel_id: 'panel-1',
    page_id: 'page-1',
    work_id: 'work-1',
    count: 1,
    entities: [
      {
        entity_id: 'entity-1',
        role: 'primary',
        expression: 'determined',
        custom_expression: null,
        action: 'attacking',
        custom_action: null,
        position: 'center',
        state_id: 'state-1',
      },
    ],
  };
}
