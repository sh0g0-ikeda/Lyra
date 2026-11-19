import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

// The deployed entry imports jsPDF on first export, possibly after the server
// has switched releases. The original module and its imports must still resolve.
let output: string;
beforeEach(async () => { output = await mkdtemp(join(tmpdir(), 'lyra-web-assets-')); });
afterEach(async () => { await rm(output, { recursive: true, force: true }); });
function restore(): void {
  execFileSync('node',
    ['apps/web/scripts/restoreReleasedAssets.mjs', output], { stdio: 'pipe' });
}
it('配信切替後も旧タブからPDFモジュールと依存ファイルを読み込める', async () => {
  restore();
  const entry = await readFile(join(output, 'index-D8wmWVX6.js'));
  expect(createHash('sha256').update(entry).digest('hex')).toBe('c9393c1f17fe2aad5be4dda4d99ac83747df3ce69cf6b1b2b1c65f8871149378');
  const files = new Set(['index-D8wmWVX6.js']);
  for (const filename of files) {
    const code = await readFile(join(output, filename), 'utf8');
    for (const match of code.matchAll(/(?:\.\/|assets\/)([\w.-]+\.js)\b/gu)) files.add(match[1]!);
  }
  expect(files).toContain('jspdf.es.min-7UXyf_23.js');
});
it('同名の新ビルド資産の内容が異なる場合は上書きせずビルドを止める', async () => {
  const collision = join(output, 'jspdf.es.min-7UXyf_23.js');
  await writeFile(collision, 'different build');
  expect(restore).toThrow();
  expect(await readFile(collision, 'utf8')).toBe('different build');
});
