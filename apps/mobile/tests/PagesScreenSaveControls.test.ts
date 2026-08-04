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
});
