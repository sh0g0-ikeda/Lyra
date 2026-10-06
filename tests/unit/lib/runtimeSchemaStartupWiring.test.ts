import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('runtime schema attestation startup wiring', () => {
  it('APIはconfig guard後かつruntime/recovery/maintenance/HTTPより前にschemaを確定する', () => {
    const source = read('src/index.ts');
    const guard = source.indexOf('assertProductionRuntimeConfig(env)');
    const attest = source.indexOf('await prepareCanonicalRuntimeSchema(');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(attest).toBeGreaterThan(guard);
    for (const marker of [
      'createFencedStateReferenceRuntime(',
      '.recoverAllStaleJobs()',
      'startPushNotificationMaintenance(',
      'serve(',
    ]) {
      expect(source.indexOf(marker)).toBeGreaterThan(attest);
    }
  });

  it('polling workerはconfig/queue検証後かつrecovery/dependency/pollerより前にattestする', () => {
    const source = read('scripts/runGenerationWorker.ts');
    const guard = source.indexOf('assertProductionRuntimeConfig(env)');
    const queue = source.indexOf('env.SQS_QUEUE_URL_GENERATION === undefined');
    const attest = source.indexOf('await attestCanonicalRuntimeSchema(db)');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(queue).toBeGreaterThan(guard);
    expect(attest).toBeGreaterThan(queue);
    expect(source.indexOf("recoveryRunner.run('startup')")).toBeGreaterThan(attest);
    expect(source.indexOf('resolveWorkerDependencies()')).toBeGreaterThan(attest);
    expect(source.indexOf('new GenerationQueuePoller(')).toBeGreaterThan(attest);
  });

  it('queue handlerは明示dependenciesを維持し省略時だけattested resolverを待つ', () => {
    const source = read('worker/index.ts');
    expect(source).toContain('dependencies?: WorkerDependencies');
    expect(source).toContain('dependencies ?? await resolveAttestedWorkerDependencies()');
    expect(source).not.toContain('dependencies: WorkerDependencies = resolveWorkerDependencies()');
  });

  it('manual retryはrepository/worker serviceを作る前にattestする', () => {
    const source = read('scripts/retryPageGenerationJob.ts');
    const attest = source.indexOf('await attestCanonicalRuntimeSchema(db)');
    expect(attest).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('new PageGenerationRetryService(')).toBeGreaterThan(attest);
    expect(source.indexOf('resolveWorkerDependencies()')).toBeGreaterThan(attest);
  });
});

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}
