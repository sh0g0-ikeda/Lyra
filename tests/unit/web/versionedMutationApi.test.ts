import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { updatePageSettingsBodySchema } from '../../../src/lib/validators/page.schema.js';

const apiSource = readFileSync(resolve('apps/web/src/lib/api.ts'), 'utf8');
const appSource = readFileSync(resolve('apps/web/src/App.tsx'), 'utf8');
const hierarchySource = readFileSync(resolve('apps/web/src/components/StoryHierarchyTree.tsx'), 'utf8');

describe('Web versioned mutation API', () => {
  it('versioned更新APIの場合に更新時刻を必須化してJSONへ変換する', () => {
    expect(apiSource).toContain('export interface VersionedMutationOptions');
    expect(apiSource).toContain('expected_updated_at: options.expectedUpdatedAt');

    for (const method of ['updateWork', 'updateChapter', 'updateEpisode', 'updateEntity']) {
      expect(apiSource).toContain(`public ${method}(`);
    }

    expect(appSource).toContain('expectedUpdatedAt: selectedEpisode.updated_at');
    expect(appSource).toContain('expectedUpdatedAt: selectedChapter.updated_at');
    expect(appSource).toContain('expectedUpdatedAt: selectedEntity.updated_at');
    expect(hierarchySource).toContain('expectedUpdatedAt: props.work.updated_at');
    expect(hierarchySource).toContain('expectedUpdatedAt: props.chapter.updated_at');
    expect(hierarchySource).toContain('expectedUpdatedAt: episode.updated_at');
  });

  it('ページ設定更新の場合にschema外の更新時刻を追加しない', () => {
    expect(apiSource).toContain(
      'public updatePage(pageId: string, body: Record<string, unknown>, organizationId?: string | null)',
    );
    expect(apiSource).toContain(
      'return this.request(`/api/pages/${pageId}${organizationQuery(organizationId)}`, { method: \'PUT\', body });',
    );
    expect(updatePageSettingsBodySchema.safeParse({
      dialogue_mode: 'mixed',
      page_dialogue_toggle: true,
    }).success).toBe(true);
    expect(updatePageSettingsBodySchema.safeParse({
      dialogue_mode: 'mixed',
      expected_updated_at: '2026-08-14T01:02:03.456Z',
    }).success).toBe(false);
  });
});
