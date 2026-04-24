import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresPageRepository } from '../../../src/repositories/PageRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public queries: string[] = [];
  public values: readonly unknown[] | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;

    if (text.includes('UPDATE pages')) {
      return {
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ id: 'page-1' }] as unknown as T[],
      };
    }

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          page_id: 'page-1',
          work_id: 'work-1',
          page_number: 3,
          episode_purpose: 'The hero confronts the rival.',
          layout_config: { type: 'template', template_id: 'standard_4' },
          dialogue_mode: 'mixed',
          page_dialogue_toggle: true,
          generated_image: null,
          generation_mode: null,
          status: 'designing',
          panel_entities: [
            {
              panel_id: 'panel-1',
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
            },
          ],
        },
      ] as unknown as T[],
    };
  }
}

describe('PostgresPageRepository', () => {
  it('user_idで所有権を絞って生成コンテキストを取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageRepository(client);

    const page = await repository.findGenerationContextByIdAndUserId('page-1', 'user-1');

    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.values).toEqual(['page-1', 'user-1']);
    expect(page).toMatchObject({
      pageId: 'page-1',
      workId: 'work-1',
      status: 'designing',
      panels: [{ panelId: 'panel-1' }],
    });
  });

  it('statusとgeneration_modeを更新する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageRepository(client);

    const updated = await repository.updateGenerationState('page-1', 'user-1', {
      status: 'generating',
      generationMode: 'thinking',
    });

    expect(updated).toBe(true);
    expect(client.queries[0]).toContain('UPDATE pages');
    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.values).toEqual(['page-1', 'user-1', 'generating', 'thinking']);
  });

  it('prompt用のページ情報を取得する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresPageRepository(client);

    const page = await repository.findPromptContextByIdAndUserId('page-1', 'user-1');

    expect(page).toMatchObject({
      pageId: 'page-1',
      workId: 'work-1',
      pageNumber: 3,
      episodePurpose: 'The hero confronts the rival.',
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
    ]);
  });
});
