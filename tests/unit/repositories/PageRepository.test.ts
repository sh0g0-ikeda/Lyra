import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresPageRepository } from '../../../src/repositories/PageRepository.js';

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
      constraint: 'pages_episode_id_page_number_key',
    };
  }
}

describe('PostgresPageRepository', () => {
  it('Page取得SQLがworks.user_idで絞る', async () => {
    const client = new QueryCapturingClient(pageRow());
    const repository = new PostgresPageRepository(client);

    await repository.findPageByIdAndUserId('77777777-7777-4777-8777-777777777777', 'user-1');

    expect(client.queries[0]).toContain('works.user_id = $2');
  });

  it('Panel更新SQLがworks.user_idで絞る', async () => {
    const client = new QueryCapturingClient(panelRow());
    const repository = new PostgresPageRepository(client);

    await repository.updatePanel('88888888-8888-4888-8888-888888888888', 'user-1', {
      panelRole: 'reaction',
    });

    expect(client.queries[0]).toContain('works.user_id = $2');
  });

  it('Page番号重複の場合にVALIDATION_ERRORになる', async () => {
    const repository = new PostgresPageRepository(new UniqueViolationClient());

    await expect(
      repository.createPage('33333333-3333-4333-8333-333333333333', {
        sceneId: null,
        pageNumber: 1,
        layoutConfig: layoutConfig(),
        dialogueMode: 'image_baked',
        pageDialogueToggle: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

function pageRow(): Record<string, unknown> {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    episode_id: '33333333-3333-4333-8333-333333333333',
    scene_id: null,
    page_number: 1,
    layout_config: layoutConfigJson(),
    dialogue_mode: 'image_baked',
    page_dialogue_toggle: true,
    generated_image: null,
    generation_mode: null,
    panel_ids: [],
    status: 'designing',
    created_at: new Date('2026-04-22T00:00:00.000Z'),
    updated_at: new Date('2026-04-22T00:00:00.000Z'),
  };
}

function panelRow(): Record<string, unknown> {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    page_id: '77777777-7777-4777-8777-777777777777',
    order: 1,
    panel_role: 'reaction',
    panel_size: 'standard',
    situation_text: null,
    entities: [],
    composition: {},
    dialogue_in_panel: true,
    dialogue: [],
    sfx_text: null,
    background_note: null,
    panel_notes: null,
    created_at: new Date('2026-04-22T00:00:00.000Z'),
    updated_at: new Date('2026-04-22T00:00:00.000Z'),
  };
}

function layoutConfig(): ReturnType<typeof layoutConfigObject> {
  return layoutConfigObject();
}

function layoutConfigObject(): {
  type: 'template';
  templateId: 'standard_4';
  panelCount: 4;
  layoutReferenceS3Key: null;
  frameDefinitions: [];
} {
  return {
    type: 'template',
    templateId: 'standard_4',
    panelCount: 4,
    layoutReferenceS3Key: null,
    frameDefinitions: [],
  };
}

function layoutConfigJson(): Record<string, unknown> {
  return {
    type: 'template',
    template_id: 'standard_4',
    panel_count: 4,
    layout_reference_s3_key: null,
    frame_definitions: [],
  };
}
