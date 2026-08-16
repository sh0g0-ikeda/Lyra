import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Mobile API bidirectional audit', () => {
  it('Backend の全 route を Mobile 導線または明示的対象外として固定する', () => {
    const inventoryPath = path.resolve('docs/mobile-backend-route-inventory.md');

    expect(existsSync(inventoryPath)).toBe(true);
    const output = execFileSync(
      process.execPath,
      [path.resolve('scripts/auditMobileApiInventory.mjs'), '--check'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
      },
    );
    const inventory = readFileSync(inventoryPath, 'utf8');

    expect(output).toMatch(/Backend route inventory is current/u);
    expect(inventory).toMatch(/Unclassified routes: \*\*0\*\*/u);
    expect(inventory).toContain('| Backend route | HTTP | Classification | Mobile path / rationale |');
  }, 60_000);
});
