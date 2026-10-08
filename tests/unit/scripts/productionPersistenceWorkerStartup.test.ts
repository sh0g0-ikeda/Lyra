import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const productionWorkers = [
  {
    name: 'account deletion worker',
    wrapper: 'startProductionAccountDeletionWorker.ts',
    workerImport: "await import('./runAccountDeletionWorker.js')",
  },
  {
    name: 'episode export worker',
    wrapper: 'startProductionEpisodeExportWorker.ts',
    workerImport: "await import('./runEpisodeExportWorker.js')",
  },
] as const;

describe('production persistence worker startup', () => {
  it.each(productionWorkers)(
    '$nameはsecret読込後にexact schemaを検証しworker import前にfail closedする',
    async ({ wrapper, workerImport }) => {
      const source = await readFile(
        join(process.cwd(), 'scripts', wrapper),
        'utf8',
      );

      const secretLoad = source.indexOf('await loadRuntimeSecretEnv()');
      const databaseImport = source.indexOf("import('../src/lib/db.js')");
      const attestationImport = source.indexOf("import('../src/lib/runtimeSchemaAttestation.js')");
      const guardImport = source.indexOf("import('../src/lib/runtimeGuards.js')");
      const attestedStart = source.indexOf('await startAttestedRuntime({');
      const exactAttestation = source.indexOf('attest: () => attestRuntimeSchema(db)');
      const capabilityCheck = source.indexOf('assertAttestedRuntimeCapabilities(runtime, {})');
      const workerStart = source.indexOf(workerImport);

      expect(secretLoad).toBeGreaterThanOrEqual(0);
      expect(databaseImport).toBeGreaterThan(secretLoad);
      expect(attestationImport).toBeGreaterThan(secretLoad);
      expect(guardImport).toBeGreaterThan(secretLoad);
      expect(attestedStart).toBeGreaterThan(attestationImport);
      expect(exactAttestation).toBeGreaterThan(attestedStart);
      expect(capabilityCheck).toBeGreaterThan(exactAttestation);
      expect(workerStart).toBeGreaterThan(capabilityCheck);
      expect(source).toContain('start: async (runtime) => {');
      expect(source).toContain('await closeDatabasePool()');
    },
  );
});
