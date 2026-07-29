import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresPageRepository } from '../../../src/repositories/PageRepository.js';
import { decodeListCursor } from '../../../src/domain/pagination.js';

class QueryCapturingClient implements DatabaseClient {
  public queries: string[] = [];
  public valueHistory: Array<readonly unknown[] | undefined> = [];
  public values: readonly unknown[] | undefined;
  public pageRows: Record<string, unknown>[] | null = null;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;
    this.valueHistory.push(values);

    if (text.includes('ORDER BY pages.page_number ASC, pages.id ASC')) {
      return {
        command: 'SELECT',
        rowCount: this.pageRows?.length ?? 0,
        oid: 0,
        fields: [],
        rows: (this.pageRows ?? []) as T[],
      };
    }

    if (text.includes('UPDATE pages')) {
      return {
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ id: 'page-1' }] as unknown as T[],
      };
    }

    if (text.includes('total_pages_in_episode')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [
          {
            page_id: 'page-1',
            work_id: 'work-1',
            episode_id: 'episode-1',
            page_number: 3,
            total_pages_in_episode: 5,
            frame_count: 4,
            status: 'designing',
            dialogue_mode: 'mixed',
            page_dialogue_toggle: true,
            episode_purpose: 'The hero confronts the rival.',
            introduction: 'Arrival at the rooftop.',
            middle: 'The discussion turns hostile.',
            climax: 'One rival steps forward.',
            ending_hook: 'A dangerous smile remains.',
            scenes: [
              {
                id: 'scene-1',
                order: 1,
                location: 'Rooftop',
                time: 'night',
                atmosphere: 'tense',
                involved_entity_ids: ['entity-1'],
                entity_states: [],
              },
            ],
            entities: [
              {
                id: 'entity-1',
                name: 'Aki',
                entity_type: 'character',
                free_description: 'Long dark hair and a navy military uniform.',
                prompt_supplement: 'Long straight black hair, navy military uniform with gold trim.',
                structured_fields: {},
              },
            ],
          },
        ] as unknown as T[],
      };
    }

    if (text.includes('SELECT panels.*')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [
          {
            id: 'panel-1',
            page_id: 'page-1',
            order: 1,
            panel_role: 'action',
            panel_size: 'standard',
            situation_text: null,
            entities: [],
            composition: {
              source: 'custom',
              gallery_item_id: null,
              composition_prompt: null,
              shot_type: null,
              angle: null,
              custom_note: null,
            },
            dialogue_in_panel: true,
            dialogue: [],
            sfx_text: null,
            background_note: null,
            panel_notes: null,
            created_at: new Date('2026-05-01T00:00:00.000Z'),
            updated_at: new Date('2026-05-01T00:00:00.000Z'),
          },
        ] as unknown as T[],
      };
    }

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          id: 'page-1',
          episode_id: 'episode-1',
          page_id: 'page-1',
          work_id: 'work-1',
          page_number: 3,
          episode_purpose: 'The hero confronts the rival.',
          scene_summaries: ['Scene 1: Rooftop / night / tense'],
          layout_config: {
            type: 'template',
            template_id: 'standard_4',
            story_source_scene_ids: ['scene-1'],
            story_page_purpose: 'This page escalates the rooftop confrontation.',
            story_continuity_note: 'Keep the mood restrained for the next page.',
          },
          story_source_scene_ids: ['scene-1'],
          story_page_purpose: 'Saved page purpose used by the generation prompt.',
          story_continuity_note: 'Saved continuity note used by the generation prompt.',
          dialogue_mode: 'mixed',
          page_dialogue_toggle: true,
          generated_image: null,
          generation_mode: null,
          status: 'designing',
          panel_count: 4,
          frame_count: 4,
          balloon_count: 1,
          panel_entities: [
            {
              panel_id: 'panel-1',
              order: 1,
              entities: [
                {
                  entity_id: 'entity-1',
                  role: 'primary',
                  expression: 'determined',
                  custom_expression: null,
                  action: 'attacking',
                  custom_action: null,
                  position: 'center',
                  facing_direction: null,
                  effect_note: null,
                  state_id: null,
                },
              ],
              dialogue: [],
            },
          ],
          created_at: new Date('2026-05-01T00:00:00.000Z'),
          updated_at: new Date('2026-05-01T00:00:00.000Z'),
        },
      ] as unknown as T[],
    };
  }
}

describe('PostgresPageRepository', () => {
  it('lists a bounded page summary page with tenant scope and no boundary duplicate', async () => {
    const client = new QueryCapturingClient();
    client.pageRows = [
      pageSummaryRow({ id: '11111111-1111-4111-8111-111111111111', page_number: 1 }),
      pageSummaryRow({ id: '22222222-2222-4222-8222-222222222222', page_number: 1 }),
      pageSummaryRow({ id: '33333333-3333-4333-8333-333333333333', page_number: 2 }),
    ];
    const repository = new PostgresPageRepository(client);

    const result = await repository.findPagesPageByEpisodeIdAndUserId('episode-1', 'user-1', {
      limit: 2,
      cursor: { sort: 0, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    }, '99999999-9999-4999-8999-999999999999');

    expect(result.items.map((page) => page.id)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(new Set(result.items.map((page) => page.id)).size).toBe(2);
    expect(result.nextCursor).toBeTypeOf('string');
    expect(decodeListCursor(result.nextCursor ?? '', 'pages')).toEqual({
      sort: 1,
      id: '22222222-2222-4222-8222-222222222222',
    });
    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain('pages.page_number > $4::integer');
    expect(client.queries[0]).toContain('pages.page_number = $4::integer AND pages.id > $5::uuid');
    expect(client.queries[0]).toContain('ORDER BY pages.page_number ASC, pages.id ASC');
    expect(client.queries[0]).toContain('LIMIT $6');
    expect(client.queries[0]).not.toContain('OFFSET');
    expect(client.queries[0].indexOf("organization_members.status = 'active'")).toBeLessThan(
      client.queries[0].indexOf('pages.page_number > $4::integer'),
    );
    expect(client.valueHistory[0]).toEqual([
      'episode-1',
      'user-1',
      '99999999-9999-4999-8999-999999999999',
      0,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      3,
    ]);
  });
  it('user_id で generation context を制限する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageRepository(client);

    const page = await repository.findGenerationContextByIdAndUserId('page-1', 'user-1');

    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.values).toEqual(['page-1', 'user-1', null]);
    expect(page).toMatchObject({
      pageId: 'page-1',
      workId: 'work-1',
      status: 'designing',
      frameCount: 4,
      panels: [{ panelId: 'panel-1' }],
    });
  });

  it('status と generation_mode を更新する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageRepository(client);

    const updated = await repository.updateGenerationState('page-1', 'user-1', {
      status: 'generating',
      generationMode: 'thinking',
    });

    expect(updated).toBe(true);
    expect(client.queries[0]).toContain('UPDATE pages');
    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.values).toEqual(['page-1', 'user-1', 'generating', 'thinking', null, null]);
  });

  it('prompt 用の page 文脈を返す', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageRepository(client);

    const page = await repository.findPromptContextByIdAndUserId('page-1', 'user-1');

    expect(page).toMatchObject({
      pageId: 'page-1',
      workId: 'work-1',
      pageNumber: 3,
      episodePurpose: 'The hero confronts the rival.',
      sceneSummaries: ['Scene 1: Rooftop / night / tense'],
      storyPagePurpose: 'Saved page purpose used by the generation prompt.',
      storyContinuityNote: 'Saved continuity note used by the generation prompt.',
      dialogueMode: 'mixed',
      pageDialogueToggle: true,
    });
  });

  it('scene autofill 用の page 文脈を返す', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageRepository(client);

    const page = await repository.findAutofillContextByIdAndUserId('page-1', 'user-1');

    expect(page).toMatchObject({
      pageId: 'page-1',
      workId: 'work-1',
      episodeId: 'episode-1',
      pageNumber: 3,
      totalPagesInEpisode: 5,
      frameCount: 4,
      dialogueMode: 'mixed',
      pageDialogueToggle: true,
      scenes: [
        expect.objectContaining({
          id: 'scene-1',
          location: 'Rooftop',
        }),
      ],
      entities: [
        expect.objectContaining({
          id: 'entity-1',
          name: 'Aki',
        }),
      ],
      panels: [
        expect.objectContaining({
          id: 'panel-1',
          order: 1,
        }),
      ],
    });
    expect(client.valueHistory[0]).toEqual(['page-1', 'user-1', null]);
    expect(client.valueHistory[1]).toEqual(['page-1', 'user-1', null]);
  });

  it('page settings を更新できる', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageRepository(client);

    const updated = await repository.updatePageSettings('page-1', 'user-1', {
      dialogueMode: 'balloon_only',
      pageDialogueToggle: false,
      storySourceSceneIds: ['scene-1'],
      storyPagePurpose: 'Saved page purpose used by the generation prompt.',
      storyContinuityNote: 'Saved continuity note used by the generation prompt.',
      layoutConfig: {
        type: 'template',
        template_id: 'standard_4',
        story_source_scene_ids: ['scene-1'],
        story_page_purpose: 'This page escalates the rooftop confrontation.',
        story_continuity_note: 'Keep the mood restrained for the next page.',
      },
    });

    expect(client.queries[0]).toContain('UPDATE pages');
    expect(client.valueHistory[0]).toEqual([
      'page-1',
      'user-1',
      'balloon_only',
      false,
      true,
      JSON.stringify({
        type: 'template',
        template_id: 'standard_4',
        story_source_scene_ids: ['scene-1'],
        story_page_purpose: 'This page escalates the rooftop confrontation.',
        story_continuity_note: 'Keep the mood restrained for the next page.',
      }),
      true,
      ['scene-1'],
      true,
      'Saved page purpose used by the generation prompt.',
      true,
      'Saved continuity note used by the generation prompt.',
      null,
    ]);
    expect(updated).toMatchObject({
      id: 'page-1',
      storySourceSceneIds: ['scene-1'],
      storyPagePurpose: 'Saved page purpose used by the generation prompt.',
      storyContinuityNote: 'Saved continuity note used by the generation prompt.',
      dialogueMode: 'mixed',
      pageDialogueToggle: true,
    });
  });

  it('generated_image と status をまとめて更新する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageRepository(client);

    const updated = await repository.updateGeneratedImageAndState('page-1', 'user-1', {
      status: 'confirmed',
      generationMode: 'standard',
      generatedImage: {
        s3Key: 'saved/user-1/pages/page-1_final.png',
        cdnUrl: 'https://img.lyra.app/saved/user-1/pages/page-1_final.png',
        generationMode: 'standard',
        generatedAt: '2026-04-24T00:00:00.000Z',
      },
    });

    expect(updated).toBe(true);
    expect(client.queries[0]).toContain('generated_image = jsonb_build_object');
    expect(client.values).toEqual([
      'page-1',
      'user-1',
      'confirmed',
      'standard',
      'saved/user-1/pages/page-1_final.png',
      'https://img.lyra.app/saved/user-1/pages/page-1_final.png',
      'standard',
      '2026-04-24T00:00:00.000Z',
      null,
    ]);
  });
});

function pageSummaryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'page-1',
    episode_id: 'episode-1',
    page_number: 1,
    layout_config: { type: 'template', template_id: 'standard_4' },
    story_source_scene_ids: [],
    story_page_purpose: null,
    story_continuity_note: null,
    dialogue_mode: 'mixed',
    page_dialogue_toggle: true,
    generation_mode: null,
    generated_image: null,
    status: 'designing',
    panel_count: 4,
    frame_count: 4,
    balloon_count: 0,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}
