import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('page story metadata migration 028', () => {
  it('既存のlayout_config契約を維持しpagesへ重複列を追加しない', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '028_preserve_page_story_metadata_in_layout_config.sql'),
      'utf8',
    );

    expect(sql).toContain('story_source_scene_ids');
    expect(sql).toContain('story_page_purpose');
    expect(sql).toContain('story_continuity_note');
    expect(sql).toContain('pages.layout_config');
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+pages\b/i);
    expect(sql).not.toMatch(/\bADD\s+COLUMN\b/i);
  });

  it('RepositoryとServiceは3項目をlayout_configで読み書きする', async () => {
    const repository = await readFile(
      join(process.cwd(), 'src', 'repositories', 'PageRepository.ts'),
      'utf8',
    );
    const service = await readFile(
      join(process.cwd(), 'src', 'services', 'page', 'PageService.ts'),
      'utf8',
    );

    expect(repository).toContain("const STORY_SOURCE_SCENE_IDS_KEY = 'story_source_scene_ids'");
    expect(repository).toContain("const STORY_PAGE_PURPOSE_KEY = 'story_page_purpose'");
    expect(repository).toContain("const STORY_CONTINUITY_NOTE_KEY = 'story_continuity_note'");
    expect(service).toContain('nextLayoutConfig.story_source_scene_ids = input.storySourceSceneIds');
    expect(service).toContain('nextLayoutConfig.story_page_purpose = input.storyPagePurpose');
    expect(service).toContain('nextLayoutConfig.story_continuity_note = input.storyContinuityNote');
  });
});
