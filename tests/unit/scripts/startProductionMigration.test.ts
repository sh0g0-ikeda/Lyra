import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production migration entrypoint', () => {
  it('Secrets Managerを読み込んでからmigrationを実行する', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts', 'startProductionMigration.ts'),
      'utf8',
    );

    const secretLoadPosition = source.indexOf('await loadRuntimeSecretEnv()');
    const migrationImportPosition = source.indexOf("await import('./migrate.js')");

    expect(secretLoadPosition).toBeGreaterThanOrEqual(0);
    expect(migrationImportPosition).toBeGreaterThan(secretLoadPosition);
  });

  it('本番用migrationコマンドは専用entrypointを使う', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['migrate:prod']).toBe(
      'bun dist/scripts/startProductionMigration.js',
    );
  });

  it('ECS migration taskはdistroless上の絶対パスで専用entrypointを使う', async () => {
    const overrides = JSON.parse(
      await readFile(join(process.cwd(), 'ecs-migrate-overrides.json'), 'utf8'),
    ) as {
      containerOverrides?: Array<{ name?: string; command?: string[] }>;
    };

    expect(overrides.containerOverrides).toEqual([
      {
        name: 'api',
        command: ['/usr/local/bin/bun', 'dist/scripts/startProductionMigration.js'],
      },
    ]);
  });
});
