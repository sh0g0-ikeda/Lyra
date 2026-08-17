import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readStoryScreenSource = (): string =>
  readFileSync(resolve(process.cwd(), 'src/screens/StoryScreen.tsx'), 'utf8');
const readPagesScreenSource = (): string =>
  readFileSync(resolve(process.cwd(), 'src/screens/PagesScreen.tsx'), 'utf8');

describe('MOB-STORY-024 話ページ数の上限', () => {
  it('想定ページ数を24ページまでに制限する', () => {
    const source = readStoryScreenSource();

    expect(source).toContain('const MAX_ESTIMATED_PAGES = 24;');
    expect(source).toContain('parseIntInRange(estimatedPages, 1, MAX_ESTIMATED_PAGES)');
  });

  it('範囲外の説明には動的な最大ページ数を使う', () => {
    const source = readStoryScreenSource();

    expect(source).toContain("t(language, 'screen.story.estimatedPagesOutOfRange', {");
    expect(source).toContain('maximum: MAX_ESTIMATED_PAGES');
    expect(source).not.toContain(
      'generated.screens.StoryScreen.estimated.pages.must.be.a.number.from.1.20301ed5'
    );
  });

  it('24ページを超える既存話を暗黙に4ページへ書き換えない', () => {
    const source = readStoryScreenSource();

    expect(source).toContain(
      'const parsedEstimatedPages = parseIntInRange(request.editor.estimatedPages, 1, MAX_ESTIMATED_PAGES);'
    );
    expect(source).toContain('if (parsedEstimatedPages === null) {');
    expect(source).toContain('estimatedPages: parsedEstimatedPages');
    expect(source).not.toContain(
      'parseIntInRange(request.editor.estimatedPages, 1, MAX_ESTIMATED_PAGES) ?? 4'
    );
  });

  it('ページ画面でも24ページを超える話の生成操作を無効にする', () => {
    const source = readPagesScreenSource();

    expect(source).toContain('const MAX_ESTIMATED_PAGES = 24;');
    expect(source).toContain('const activeEpisode = workspaceContext.episodes.find(');
    expect(source).toContain('activeEpisode.estimated_pages > MAX_ESTIMATED_PAGES');
    expect(source).toContain('estimatedPagesInvalid={estimatedPagesInvalid}');
    expect(source).not.toContain('estimatedPagesInvalid={false}');
  });
});
