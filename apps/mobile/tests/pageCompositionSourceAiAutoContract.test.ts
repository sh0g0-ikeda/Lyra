import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('モバイルの構図ソース契約', () => {
  it('構図ソースの選択UIを表示せず保存時はAI自動に固定する', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
      'utf8'
    );

    expect(source).not.toContain('panelCompositionSourceOptions');
    expect(source).not.toContain('setCompositionSource');
    expect(source).not.toContain('CompositionPicker');
    expect(source).not.toContain('api.getCompositions()');
    expect(source).not.toContain('selectedPanel.composition.source');
    expect(source).toContain("source: 'ai_auto'");
    expect(source).toContain('gallery_item_id: null');
  });
});
