import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

describe('Maestro release-like E2E configuration', () => {
  it('正式なmanifest、staging実行、store実行を明示する', async () => {
    const packageJson = JSON.parse(
      await readFile(join(projectRoot, 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> };
    const stagingRunner = await readFile(
      join(projectRoot, 'scripts', 'runMaestroStaging.mjs'),
      'utf8'
    );

    expect(packageJson.scripts?.['e2e:maestro:smoke']).toBeUndefined();
    expect(packageJson.scripts?.['e2e:maestro:staging']).toContain('runMaestroStaging.mjs');
    expect(packageJson.scripts?.['e2e:maestro:store']).toContain('E2E-15');
    expect(stagingRunner).toContain("'e2e-manifest.json'");

    const scenarioExecutionIndex = stagingRunner.indexOf(
      'const result = spawnSync('
    );
    const evidenceVerificationIndex = stagingRunner.lastIndexOf(
      'await verifyExternalEvidence(scenario, platform, runId)'
    );
    expect(scenarioExecutionIndex).toBeGreaterThanOrEqual(0);
    expect(evidenceVerificationIndex).toBeGreaterThan(scenarioExecutionIndex);
  });
});
