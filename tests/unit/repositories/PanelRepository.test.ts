import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresPanelRepository } from '../../../src/repositories/PanelRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public values: readonly unknown[] | undefined;
  public valuesList: Array<readonly unknown[] | undefined> = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;
    this.valuesList.push(values);

    if (text.includes('DELETE FROM panels')) {
      return {
        command: 'DELETE',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ id: 'panel-1' }] as unknown as T[],
      };
    }

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [panelRow()] as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('PostgresPanelRepository', () => {
  it('user_idでページ所有者を絞ってPanel一覧を取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelRepository(client);

    const panels = await repository.findPanelsByPageIdAndUserId('page-1', 'user-1');

    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.queries[0]).toContain('ORDER BY panels."order" ASC');
    expect(client.values).toEqual(['page-1', 'user-1']);
    expect(panels[0]).toMatchObject({
      id: 'panel-1',
      pageId: 'page-1',
      panelRole: 'action',
      panelSize: 'standard',
    });
  });

  it('Panel作成時にuser_idでページ所有者を確認する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelRepository(client);

    await repository.createPanel('page-1', 'user-1', {
      order: 2,
      panelRole: 'reaction',
      panelSize: 'wide',
      situationText: 'A reaction shot',
      composition: {
        source: 'gallery',
        galleryItemId: 'battle_single_001',
        compositionPrompt: 'hero close-up',
        shotType: 'close_up',
        angle: 'three_quarter',
        customNote: 'focus on eyes',
      },
      dialogueInPanel: true,
      dialogue: [
        {
          entityId: 'entity-1',
          text: 'What happened?',
          type: 'speech',
          position: 'top',
        },
      ],
      sfxText: 'Boom',
      backgroundNote: 'Smoke everywhere',
      panelNotes: 'Large reaction panel',
    });

    expect(client.queries[0]).toContain('INSERT INTO panels');
    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.values).toEqual([
      'page-1',
      'user-1',
      2,
      'reaction',
      'wide',
      'A reaction shot',
      JSON.stringify({
        source: 'gallery',
        gallery_item_id: 'battle_single_001',
        composition_prompt: 'hero close-up',
        shot_type: 'close_up',
        angle: 'three_quarter',
        custom_note: 'focus on eyes',
      }),
      true,
      JSON.stringify([
        {
          entity_id: 'entity-1',
          text: 'What happened?',
          type: 'speech',
          position: 'top',
        },
      ]),
      'Boom',
      'Smoke everywhere',
      'Large reaction panel',
    ]);
  });

  it('Panel更新時にJSONB列を保存する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelRepository(client);

    await repository.updatePanel('panel-1', 'user-1', {
      composition: {
        source: 'custom',
        galleryItemId: null,
        compositionPrompt: 'full body stance',
        shotType: 'full_body',
        angle: 'front',
        customNote: null,
      },
      dialogue: [
        {
          entityId: null,
          text: 'Boom',
          type: 'sfx',
          position: 'center',
        },
      ],
      panelNotes: 'Updated panel note',
    });

    expect(client.queries[0]).toContain('UPDATE panels');
    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.valuesList[0]?.[0]).toBe('panel-1');
    expect(client.valuesList[0]?.[1]).toBe('user-1');
    expect(client.valuesList[0]?.[7]).toBe(true);
    expect(client.valuesList[0]?.[8]).toBe(
      JSON.stringify({
        source: 'custom',
        gallery_item_id: null,
        composition_prompt: 'full body stance',
        shot_type: 'full_body',
        angle: 'front',
        custom_note: null,
      }),
    );
    expect(client.valuesList[0]?.[11]).toBe(true);
    expect(client.valuesList[0]?.[12]).toBe(
      JSON.stringify([
        {
          entity_id: null,
          text: 'Boom',
          type: 'sfx',
          position: 'center',
        },
      ]),
    );
  });

  it('Panel削除時に関連するpanel_frame参照を外してから削除する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPanelRepository(client);

    const deleted = await repository.deletePanel('panel-1', 'user-1');

    expect(deleted).toBe(true);
    expect(client.queries[0]).toContain('UPDATE panel_frames');
    expect(client.queries[0]).toContain('SET panel_id = NULL');
    expect(client.queries[1]).toContain('DELETE FROM panels');
    expect(client.queries[1]).toContain('works.user_id = $2');
  });
});

function panelRow(): Record<string, unknown> {
  return {
    id: 'panel-1',
    page_id: 'page-1',
    order: 1,
    panel_role: 'action',
    panel_size: 'standard',
    situation_text: 'A dramatic action panel',
    entities: [
      {
        entity_id: 'entity-1',
        role: 'primary',
        expression: 'determined',
        custom_expression: null,
        action: 'attacking',
        custom_action: null,
        position: 'center',
        state_id: null,
      },
    ],
    composition: {
      source: 'custom',
      gallery_item_id: null,
      composition_prompt: null,
      shot_type: null,
      angle: null,
      custom_note: null,
    },
    dialogue_in_panel: true,
    dialogue: [
      {
        entity_id: 'entity-1',
        text: 'Take this!',
        type: 'speech',
        position: 'top',
      },
    ],
    sfx_text: null,
    background_note: null,
    panel_notes: null,
    created_at: new Date('2026-04-23T00:00:00.000Z'),
    updated_at: new Date('2026-04-23T00:00:00.000Z'),
  };
}
