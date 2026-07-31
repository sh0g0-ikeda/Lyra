import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const inventoryPath = 'docs/backend-api-contract-inventory.md';

describe('Backend API contract inventory', () => {
  it('生成済みinventoryが現在のRoute定義と一致する', async () => {
    await expect(
      execFileAsync(process.execPath, [
        'scripts/auditBackendApiInventory.mjs',
        '--check',
      ]),
    ).resolves.toMatchObject({ stderr: '' });
  });

  it('全endpointを分類しjob cursorと実mountの重複sourceを記録する', async () => {
    const inventory = await readFile(inventoryPath, 'utf8');
    const routeRows = inventory
      .split(/\r?\n/gu)
      .filter((line) => line.startsWith('| `'));

    expect(routeRows.length).toBeGreaterThanOrEqual(80);
    expect(inventory).not.toContain('UNCLASSIFIED');
    expect(inventory).toContain(
      '| `/api/jobs` | GET | Authenticated | Strict JSON | `generationJobHistoryResponseSchema` | Opaque cursor (1-100; max 512 chars) | `src/routes/jobs.ts` |',
    );
    expect(inventory).toContain(
      '| `/api/compositions` | GET | Authenticated | Strict JSON | `compositionsResponseSchema` | Bounded limit (1-250) | `src/routes/compositions.ts` |',
    );
    expect(inventory).toContain(
      '`src/app.ts`, `src/routes/organizations.ts`',
    );
    expect(inventory).toContain(
      '| `/api/works` | GET | Authenticated | Strict JSON | `worksResponseSchema` | Optional opaque cursor (1-100; max 512 chars) | `src/routes/story.ts` |',
    );
    expect(inventory).toContain(
      '| `/api/works/:work_id/entities` | GET | Authenticated | Strict JSON | `entitiesResponseSchema` | Optional opaque cursor (1-100; max 512 chars) | `src/routes/entities.ts` |',
    );
  });
});
