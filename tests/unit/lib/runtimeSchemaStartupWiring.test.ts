import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('runtime schema attestation startup wiring', () => {
  it('APIはconfig guard後かつruntime/recovery/maintenance/HTTPより前にschemaを確定する', () => {
    const source = read('src/index.ts');
    const guard = source.indexOf('assertProductionRuntimeConfig(env)');
    const startup = source.indexOf('await startAttestedCanonicalRuntime(');
    const attest = source.indexOf('await prepareCanonicalRuntimeSchema(');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(startup).toBeGreaterThan(guard);
    expect(attest).toBeGreaterThan(guard);
    expect(source).toContain('attest: prepareRuntimeSchema');
    expect(source).toContain('start: startRuntime');
    expect(source).toContain('createApp({ fencedStateReferenceRuntime, attestedRuntime: runtime })');
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
    const attest = source.indexOf('attest: () => attestCanonicalRuntimeSchema(db)');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(queue).toBeGreaterThan(guard);
    expect(attest).toBeGreaterThan(queue);
    expect(source.indexOf("recoveryRunner.run('startup')")).toBeGreaterThan(attest);
    expect(source.indexOf('resolveWorkerDependencies({}, runtime)')).toBeGreaterThan(attest);
    expect(source.indexOf('new GenerationQueuePoller(')).toBeGreaterThan(attest);
    expect(source).toContain('new GenerationWorkerRecoveryRunner(organizationService, runtime)');
    expect(source).toContain('this.runtime.repositoryProfile');
  });

  it('queue handlerは明示dependenciesを維持し省略時だけattested resolverを待つ', () => {
    const source = read('worker/index.ts');
    expect(source).toContain('dependencies?: WorkerDependencies');
    expect(source).toContain('dependencies ?? await resolveAttestedWorkerDependencies()');
    expect(source).not.toContain('dependencies: WorkerDependencies = resolveWorkerDependencies()');
  });

  it('manual retryはrepository/worker serviceを作る前にattestする', () => {
    const source = read('scripts/retryPageGenerationJob.ts');
    const attest = source.indexOf('attest: () => attestCanonicalRuntimeSchema(db)');
    expect(attest).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('new PageGenerationRetryService(')).toBeGreaterThan(attest);
    expect(source.indexOf('resolveWorkerDependencies({}, runtime)')).toBeGreaterThan(attest);
  });

  it('起動入口と遅延helperは検証済みprofileを使い環境profileの再取得をしない', () => {
    for (const file of ['src/index.ts', 'scripts/runGenerationWorker.ts', 'scripts/retryPageGenerationJob.ts']) {
      expect(read(file)).not.toContain('env.LYRA_PERSISTENCE_PROFILE');
    }
    const app = read('src/app.ts');
    const worker = read('worker/dependencies.ts');
    // The sole fallback preserves createApp/worker isolated DI defaults. Boot
    // entrypoints supply the attested value; subordinate helpers receive it.
    expect(app.match(/env\.LYRA_PERSISTENCE_PROFILE/gu)).toHaveLength(1);
    expect(worker.match(/env\.LYRA_PERSISTENCE_PROFILE/gu)).toHaveLength(1);
    expect(app).toContain('dependencies.attestedRuntime?.repositoryProfile ?? env.LYRA_PERSISTENCE_PROFILE');
    expect(worker).toContain('attestedRuntime?.repositoryProfile ?? env.LYRA_PERSISTENCE_PROFILE');
    expect(worker).toContain('start: (runtime) => resolveWorkerDependencies(overrides, runtime)');
    expect(worker).toContain('resolvePageGenerationInputImageBuilder(persistenceProfile)');
    expect(app).toContain('resolveWorkerDependencies({}, dependencies.attestedRuntime)');
  });
});

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}
