import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readAppSource = (): string =>
  readFileSync(resolve(process.cwd(), 'apps/web/src/App.tsx'), 'utf8');

describe('Web 話ページ数の上限', () => {
  it('想定ページ数を24ページまでに制限する', () => {
    const source = readAppSource();

    expect(source).toContain('const MAX_EPISODE_PAGES = 24;');
    expect(source).toContain('max={MAX_EPISODE_PAGES}');
  });

  it('保存と自動保存で25ページ以上を送信しない', () => {
    const source = readAppSource();

    expect(source).toContain(
      "parseBoundedNumberInput(draft.estimated_pages, 'estimated pages', 1, MAX_EPISODE_PAGES)"
    );
  });
});
