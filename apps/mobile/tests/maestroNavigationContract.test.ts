import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const root = resolve(import.meta.dirname, '../.maestro');
describe('Maestroの4タブ導線移行（静的検証のみ）', () => {
  it('旧5タブselectorを使わず漫画工程とアセット入口を選ぶ', () => {
    const helpers = readdirSync(resolve(root, 'helpers')).filter((name) => name.endsWith('.yaml')).map((name) => readFileSync(resolve(root, 'helpers', name), 'utf8')).join('\n');
    expect(helpers).not.toMatch(/id: tab-(pages|story|characters)\b/u);
    expect(helpers).toContain('id: tab-manga'); expect(helpers).toContain('id: tab-assets'); expect(helpers).toContain('id: manga-step-pages');
    expect(helpers).toContain('id: page-quote-accept');
  });
  it('generationのシナリオは明示見積受付を経由する', () => {
    for (const file of ['e2e-06-page-edit-generate-confirm-export.yaml', 'e2e-16-save-and-generate-atomicity-409-conflict.yaml']) {
      const text = readFileSync(resolve(root, 'flows', file), 'utf8');
      expect(text).toContain('id: page-step-create'); expect(text).toContain('file: ../helpers/accept-page-quote.yaml');
    }
    expect(readFileSync(resolve(root, 'NAVIGATION_MIGRATION.md'), 'utf8')).toContain('have not been run on a native device');
  });
});
