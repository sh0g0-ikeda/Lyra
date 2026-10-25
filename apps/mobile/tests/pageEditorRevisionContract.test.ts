import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('page editor revision contract', () => {
  it('同じ入力値の別ページを区別するため選択ページIDを含める', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
      'utf8'
    );

    expect(source).toMatch(
      /const pageEditorRevision = JSON\.stringify\(\{\s*pageId: selectedPage\?\.id \?\? null,/
    );
  });

  it('選択スコープ変更時に過去のページ操作エラーをリセットする', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
      'utf8'
    );

    expect(source).toContain('useResetOnScopeChange(pageErrorScope');
    expect(source).toContain('updatePageMutation.reset');
    expect(source).toContain('generatePageMutation.reset');
    expect(source).toContain('exportPagesMutation.reset');
    expect(source).toContain('downloadPageMutation.reset');
    expect(source).toContain('setPageImageDownloadError(null)');
  });

  it('手動の確定UIを省いて生成前の未保存入力保存を維持する', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
      'utf8'
    );

    expect(source).not.toContain('<PageConfirmationAction');
    expect(source).toContain('await saveAllPageDrafts();');
    const quotePreparation = source.slice(source.indexOf('prepare: async (target) =>'));
    expect(quotePreparation.indexOf('await saveAllPageDrafts();')).toBeLessThan(
      quotePreparation.indexOf('await api.getPage(target.pageId')
    );
  });
});
