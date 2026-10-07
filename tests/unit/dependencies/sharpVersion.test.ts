import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('sharp dependency contract', () => {
  it('libheifとlibrsvgのsecurity fixを含む0.35.5へ固定する', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const lockfile = JSON.parse(
      await readFile(join(process.cwd(), 'package-lock.json'), 'utf8'),
    ) as {
      packages?: Record<string, {
        version?: string;
      }>;
    };

    expect(packageJson.dependencies?.sharp).toBe('0.35.5');
    expect(lockfile.packages?.['node_modules/sharp']?.version).toBe('0.35.5');
  });
});
