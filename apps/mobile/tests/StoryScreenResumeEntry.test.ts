import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readStoryScreen = (): string =>
  readFileSync(resolve(process.cwd(), 'src/screens/StoryScreen.tsx'), 'utf8');

describe('StoryScreen 漫画一覧からの再開入口', () => {
  it('作品がない場合は空状態を示し、既存作品は階層選択から話を再開する', () => {
    const source = readStoryScreen();

    expect(source).toContain('const hasWorks = works.length > 0;');
    expect(source).toContain("message={t(language, 'emptyWorks')}");
    expect(source).toContain("message={t(language, 'selectEpisodeFirst')}");
    expect(source.indexOf('<WorkspaceHierarchyNavigator')).toBeLessThan(
      source.indexOf("message={t(language, 'selectEpisodeFirst')}")
    );
  });
});
