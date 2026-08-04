import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('PagesScreen manual save controls', () => {
  it('自動保存されるページ編集に非機能な手動保存ボタンを表示しない', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
      'utf8'
    );

    expect(source).not.toContain("label={t(language, 'save')}");
  });

  it('ページ画像の保存は写真ライブラリ保存を使い、専用UIを残す', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
      'utf8'
    );

    expect(source).toContain('saveImageBlobToPhotoLibrary');
    expect(source).toContain('api.exportPageImage');
    expect(source).not.toContain('buildPageImageDownloadSources');
    expect(source).not.toContain('saveImageToPhotoLibrary({');
    expect(source).toContain('generated.screens.PagesScreen.save.image.dd680bcb');
  });
});
