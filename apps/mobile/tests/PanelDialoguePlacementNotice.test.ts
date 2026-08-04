import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('PanelDialoguePlacementNotice', () => {
  it('画像外セリフの警告をモバイル画面に表示しない', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/components/PanelDialoguePlacementNotice.tsx'),
      'utf8'
    );

    expect(source).not.toContain('outside.art');
    expect(source).toContain('return null;');
  });
});
