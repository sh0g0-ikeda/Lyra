import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('page image download feedback contract', () => {
  it('画像の保存開始時に古い結果を消し成功後に完了表示を出す', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
      'utf8'
    );

    expect(source).toContain('setPageImageDownloadSuccess(false)');
    expect(source).toContain('onSuccess: () => {\n      setPageImageDownloadSuccess(true);');
    expect(source).toContain("t(language, 'shared.fileTransfer.saved')");
    expect(source).toContain('tone="success"');
  });
});
