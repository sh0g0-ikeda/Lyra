import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Exercise the real generator in an isolated tree. Git may use CRLF on Windows;
// equivalent line endings must pass, but changed contracts must still fail.
test('contract check accepts checkout line endings and rejects stale or missing content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lyra-contract-check-'));
  try {
    await mkdir(join(root, 'scripts'), { recursive: true });
    await mkdir(join(root, 'packages/api-contract/src'), { recursive: true });
    await mkdir(join(root, 'apps/mobile/src/domain'), { recursive: true });
    const script = join(root, 'scripts/generateMobileApiContract.mjs');
    await copyFile(fileURLToPath(new URL('../generateMobileApiContract.mjs', import.meta.url)), script);
    const canonical = join(root, 'packages/api-contract/src/mobileApiSchemas.ts');
    const generated = join(root, 'apps/mobile/src/domain/apiSchemas.ts');
    await writeFile(canonical, 'export const contract = 1;\r\n');
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    const expected = await readFile(generated, 'utf8');
    for (const newline of ['\n', '\r\n', '\r']) {
      await writeFile(generated, expected.replaceAll('\n', newline));
      const result = run('--check');
      assert.equal(result.status, 0, `${JSON.stringify(newline)}: ${result.stderr}`);
    }
    await writeFile(generated, expected.replace('contract = 1', 'contract = 2'));
    const stale = run('--check');
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /generated file is stale/);
    await rm(generated);
    const missing = run('--check');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /generated file is missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
