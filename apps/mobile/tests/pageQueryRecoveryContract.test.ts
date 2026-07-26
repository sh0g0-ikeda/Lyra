import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ページ画面の取得エラー回復契約', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
    'utf8'
  );

  it('選択ページを現在の話への所属で検証する', () => {
    expect(source).toContain('selectPageForEpisode(');
    expect(source).toContain('selectedPageWrongEpisode');
    expect(source).toContain('shouldFetchSelectedPageDetail &&');
  });

  it('必須取得と補助取得のエラーを分離する', () => {
    expect(source).toContain('currentQueryError({');
    expect(source).toContain('supportingQueryError({');
    expect(source).toContain('primaryPageFailure?.retry()');
  });

  it('ページ一覧の解決後に補助取得を開始する', () => {
    expect(source).toContain(
      'activeEpisodeId !== null && pagesQuery.isSuccess'
    );
    expect(source).toContain('enabled: pageHierarchyReady');
  });
});
