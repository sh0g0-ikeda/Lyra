import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresPageRepository } from '../../../src/repositories/PageRepository.js';

const pageId = '55555555-5555-4555-8555-555555555555';
const userId = '11111111-1111-4111-8111-111111111111';
const episodeId = '44444444-4444-4444-8444-444444444444';
const staleSceneId = '66666666-6666-4666-8666-666666666666';
const physicalSceneId = '77777777-7777-4777-8777-777777777777';

type LegacyRepositoryConstructor = new (
  client: DatabaseClient,
  mode: 'legacyPhysical',
) => PostgresPageRepository;

class PhysicalMetadataClient implements DatabaseClient {
  public readonly queries: string[] = [];
  public readonly values: Array<readonly unknown[] | undefined> = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);

    if (text.includes('UPDATE pages')) {
      return {
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ id: pageId }] as unknown as T[],
      };
    }

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [this.row()] as unknown as T[],
    };
  }

  private row(): Record<string, unknown> {
    return {
      id: pageId,
      page_id: pageId,
      episode_id: episodeId,
      work_id: 'work-1',
      page_number: 1,
      layout_config: {
        type: 'template',
        story_source_scene_ids: [staleSceneId],
        story_page_purpose: 'stale JSON purpose',
        story_continuity_note: 'stale JSON continuity',
      },
      story_source_scene_ids: [physicalSceneId],
      story_page_purpose: 'physical purpose',
      story_continuity_note: 'physical continuity',
      episode_purpose: null,
      scene_summaries: [],
      dialogue_mode: 'mixed',
      page_dialogue_toggle: true,
      generation_mode: null,
      generated_image: null,
      status: 'designing',
      panel_count: 0,
      frame_count: 0,
      balloon_count: 0,
      created_at: new Date('2026-10-04T00:00:00.000Z'),
      updated_at: new Date('2026-10-04T00:00:00.000Z'),
    };
  }
}

function legacyRepository(client: DatabaseClient): PostgresPageRepository {
  return new (PostgresPageRepository as unknown as LegacyRepositoryConstructor)(client, 'legacyPhysical');
}

describe('PostgresPageRepository legacy physical story metadata', () => {
  it('legacyPhysicalはstale JSONでなく物理三列をlist/find/pagination/promptで読む', async () => {
    const client = new PhysicalMetadataClient();
    const repository = legacyRepository(client);

    const listed = await repository.findPagesByEpisodeIdAndUserId(episodeId, userId);
    const paginated = await repository.findPagesPageByEpisodeIdAndUserId(
      episodeId,
      userId,
      { limit: 1, cursor: null },
    );
    const found = await repository.findPageByIdAndUserId(pageId, userId);
    const prompt = await repository.findPromptContextByIdAndUserId(pageId, userId);

    for (const value of [...listed, ...paginated.pages, found]) {
      expect(value).toMatchObject({
        storySourceSceneIds: [physicalSceneId],
        storyPagePurpose: 'physical purpose',
        storyContinuityNote: 'physical continuity',
      });
    }
    expect(prompt).toMatchObject({
      storyPagePurpose: 'physical purpose',
      storyContinuityNote: 'physical continuity',
    });
    expect(found?.layoutConfig).toMatchObject({
      story_source_scene_ids: [staleSceneId],
      story_page_purpose: 'stale JSON purpose',
      story_continuity_note: 'stale JSON continuity',
    });
    for (const query of client.queries) {
      expect(query).toContain('pages.story_source_scene_ids');
      expect(query).toContain('pages.story_page_purpose');
      expect(query).toContain('pages.story_continuity_note');
    }
  });

  it('legacyPhysicalはvalue/null/[]を物理三列へ書き、undefinedとlayout-only保存では変更しない', async () => {
    const client = new PhysicalMetadataClient();
    const repository = legacyRepository(client);

    await repository.updatePageSettings(pageId, userId, {
      storySourceSceneIds: [],
      storyPagePurpose: null,
      storyContinuityNote: 'next physical continuity',
    });
    const metadataWrite = client.queries.find((query) => query.includes('UPDATE pages'))!;
    const metadataValues = client.values[client.queries.indexOf(metadataWrite)]!;

    expect(metadataWrite).toContain('story_source_scene_ids = CASE');
    expect(metadataWrite).toContain('story_page_purpose = CASE');
    expect(metadataWrite).toContain('story_continuity_note = CASE');
    expect(metadataValues).toContain(true);
    expect(metadataValues).toContainEqual([]);
    expect(metadataValues).toContain('next physical continuity');

    const nextClient = new PhysicalMetadataClient();
    const nextRepository = legacyRepository(nextClient);
    await nextRepository.updatePageSettings(pageId, userId, { layoutConfig: { type: 'custom' } });
    const layoutOnlyValues = nextClient.values[
      nextClient.queries.findIndex((query) => query.includes('UPDATE pages'))
    ]!;
    expect(layoutOnlyValues).toEqual(expect.arrayContaining([false, false, false]));
  });

  it('canonical defaultは物理三列をSELECT/UPDATEせずJSON metadataを維持する', async () => {
    const client = new PhysicalMetadataClient();
    const repository = new PostgresPageRepository(client);

    const page = await repository.findPageByIdAndUserId(pageId, userId);
    await repository.updatePageSettings(pageId, userId, {
      storyPagePurpose: 'canonical purpose',
    });

    expect(page?.storySourceSceneIds).toEqual([staleSceneId]);
    expect(page?.storyPagePurpose).toBe('stale JSON purpose');
    for (const query of client.queries) {
      expect(query).not.toContain('pages.story_source_scene_ids');
      expect(query).not.toContain('pages.story_page_purpose');
      expect(query).not.toContain('pages.story_continuity_note');
    }
  });
});
