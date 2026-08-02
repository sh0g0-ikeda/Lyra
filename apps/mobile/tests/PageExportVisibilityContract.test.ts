import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ページ画面のエピソード書き出し表示契約', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
    'utf8'
  );

  it('episode exportが無効の場合はPDFとZIPの書き出しセクションを渡さない', () => {
    expect(source).toContain('config.episodeExportEnabled ? (');
  });

  it('episode exportが有効の場合だけ既存のPDFとZIP書き出しセクションを渡す', () => {
    expect(source).toContain("{ value: 'pdf', label: 'PDF' }");
    expect(source).toContain("{ value: 'zip'");
  });
});
