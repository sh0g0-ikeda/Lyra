import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import type { PanelEntityAssignment } from '../../../src/domain/types/panelEntityAssignment.js';
import { PostgresPanelEntityAssignmentRepository } from '../../../src/repositories/PanelEntityAssignmentRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public returnedEntities: unknown = panelRow().entities;
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
      rows: [{ ...panelRow(), entities: this.returnedEntities }] as unknown as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('PostgresPanelEntityAssignmentRepository', () => {
  it('user_idでPanel所有者を絞ってcontextを取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelEntityAssignmentRepository(client);

    const context = await repository.findPanelContextByIdAndUserId('panel-1', 'user-1');

    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.values).toEqual(['panel-1', 'user-1', null]);
    expect(context).toEqual({ panelId: 'panel-1', pageId: 'page-1', workId: 'work-1' });
  });

  it('同一work内のentity数を数える', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelEntityAssignmentRepository(client);

    await repository.countEntitiesByIdsAndWorkIdAndUserId(['entity-1'], 'work-1', 'user-1');

    expect(client.queries[0]).toContain('COUNT(DISTINCT id)::int AS count');
    expect(client.queries[0]).toContain('work_id = $2');
    expect(client.values).toEqual([['entity-1'], 'work-1', 'user-1', null]);
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
      null,
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
        facingDirection: 'front',
        effectNote: 'motion blur streaks',
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
          facing_direction: 'front',
          effect_note: 'motion blur streaks',
          state_id: 'state-1',
        },
      ]),
      null,
    ]);
    expect(assignments?.[0]).toMatchObject({ entityId: 'entity-1', stateId: 'state-1' });
  });

  it('従来更新は契約外の保存済みentryを従来どおり読み飛ばす', async () => {
    const client = new QueryCapturingClient();
    client.returnedEntities = [{ entity_id: 'entity-1' }];
    const repository = new PostgresPanelEntityAssignmentRepository(client);

    await expect(
      repository.updatePanelEntityAssignments('panel-1', 'user-1', []),
    ).resolves.toEqual([]);
  });

  it('条件付き保存はPageからPanel、Entity、stateの順にlockして全置換する', async () => {
    const client = new ConditionalQueryClient();
    const repository = new PostgresPanelEntityAssignmentRepository(client);
    const expected = [conditionalAssignment()];
    const replacement = [conditionalAssignment({
      expression: 'calm',
      action: 'running',
      effectNote: 'after',
    })];

    const result = await repository.replacePanelEntityAssignmentsConditionally(
      'panel-1',
      'user-1',
      expected,
      replacement,
      null,
    );

    expect(result).toEqual({ status: 'saved', assignments: replacement });
    expect(client.transactionCount).toBe(1);
    expect(client.queries.map(queryKind)).toEqual([
      'page-lock',
      'panel-lock',
      'entity-lock',
      'state-lock',
      'panel-update',
    ]);
    expect(client.valuesByKind.get('page-lock')).toEqual(['panel-1', 'user-1', null]);
    expect(client.valuesByKind.get('panel-update')).toEqual([
      'panel-1',
      JSON.stringify(replacement.map(toAssignmentJson)),
    ]);
  });

  it('保存前snapshotが違う場合はstaleとして更新しない', async () => {
    const client = new ConditionalQueryClient();
    client.storedAssignments = [conditionalAssignment({ role: 'secondary' })];
    const repository = new PostgresPanelEntityAssignmentRepository(client);

    const result = await repository.replacePanelEntityAssignmentsConditionally(
      'panel-1',
      'user-1',
      [conditionalAssignment()],
      [conditionalAssignment({ role: 'background' })],
      null,
    );

    expect(result).toEqual({ status: 'stale' });
    expect(client.queries.map(queryKind)).toEqual(['page-lock', 'panel-lock']);
  });

  it.each(['confirmed', 'generating'] as const)(
    '%s Pageでは条件付き保存を更新前に拒否する',
    async (pageStatus) => {
      const client = new ConditionalQueryClient();
      client.pageStatus = pageStatus;
      const repository = new PostgresPanelEntityAssignmentRepository(client);

      const result = await repository.replacePanelEntityAssignmentsConditionally(
        'panel-1',
        'user-1',
        [conditionalAssignment()],
        [conditionalAssignment()],
        null,
      );

      expect(result).toEqual({ status: 'page_not_editable' });
      expect(client.queries.map(queryKind)).toEqual(['page-lock']);
    },
  );

  it('会話speakerを新しいassignmentから外す場合は更新しない', async () => {
    const client = new ConditionalQueryClient();
    client.dialogue = [
      { entity_id: 'entity-1', text: 'hello', type: 'speech', position: 'top' },
      { entity_id: null, text: 'later', type: 'narration', position: 'bottom' },
    ];
    const repository = new PostgresPanelEntityAssignmentRepository(client);

    const result = await repository.replacePanelEntityAssignmentsConditionally(
      'panel-1',
      'user-1',
      [conditionalAssignment()],
      [],
      null,
    );

    expect(result).toEqual({ status: 'dialogue_speaker_not_assigned' });
    expect(client.queries.map(queryKind)).toEqual(['page-lock', 'panel-lock']);
  });
});

class ConditionalQueryClient implements DatabaseClient, TransactionRunner {
  public dialogue: unknown = [];
  public pageStatus: 'designing' | 'generating' | 'generated' | 'editing' | 'confirmed' = 'designing';
  public queries: string[] = [];
  public storedAssignments: PanelEntityAssignment[] = [conditionalAssignment()];
  public transactionCount = 0;
  public valuesByKind = new Map<string, readonly unknown[] | undefined>();

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    const kind = queryKind(text);
    this.valuesByKind.set(kind, values);
    const rows = kind === 'page-lock'
      ? [{ page_id: 'page-1', work_id: 'work-1', page_status: this.pageStatus }]
      : kind === 'panel-lock'
        ? [{ entities: this.storedAssignments.map(toAssignmentJson), dialogue: this.dialogue }]
        : kind === 'entity-lock'
          ? [{ id: 'entity-1' }]
          : kind === 'state-lock'
            ? [{ entity_id: 'entity-1', state_id: 'state-1' }]
            : kind === 'panel-update'
              ? [{ entities: JSON.parse(String(values?.[1])) as unknown }]
              : [];
    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }
}

function queryKind(text: string): string {
  if (text.includes('FOR UPDATE OF pages')) return 'page-lock';
  if (text.includes('FOR UPDATE') && text.includes('FROM panels')) return 'panel-lock';
  if (text.includes('FOR KEY SHARE') && text.includes('FROM entities')) return 'entity-lock';
  if (text.includes('FOR KEY SHARE') && text.includes('entity_states')) return 'state-lock';
  if (text.includes('UPDATE panels')) return 'panel-update';
  return 'unknown';
}

function conditionalAssignment(
  overrides: Partial<PanelEntityAssignment> = {},
): PanelEntityAssignment {
  return {
    entityId: 'entity-1',
    role: 'primary',
    expression: 'determined',
    customExpression: null,
    action: 'attacking',
    customAction: null,
    position: 'center',
    facingDirection: 'front',
    effectNote: null,
    stateId: 'state-1',
    ...overrides,
  };
}

function toAssignmentJson(assignment: PanelEntityAssignment): Record<string, unknown> {
  return {
    entity_id: assignment.entityId,
    role: assignment.role,
    expression: assignment.expression,
    custom_expression: assignment.customExpression,
    action: assignment.action,
    custom_action: assignment.customAction,
    position: assignment.position,
    facing_direction: assignment.facingDirection,
    effect_note: assignment.effectNote,
    state_id: assignment.stateId,
  };
}

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
        facing_direction: 'front',
        effect_note: 'motion blur streaks',
        state_id: 'state-1',
      },
    ],
  };
}
