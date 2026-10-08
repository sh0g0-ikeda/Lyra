import { loadRuntimeSecretEnv } from '../src/lib/runtimeSecretEnv.js';

await loadRuntimeSecretEnv();
const [
  { closeDatabasePool, db },
  { attestRuntimeSchema, startAttestedRuntime },
  { assertAttestedRuntimeCapabilities },
] = await Promise.all([
  import('../src/lib/db.js'),
  import('../src/lib/runtimeSchemaAttestation.js'),
  import('../src/lib/runtimeGuards.js'),
]);

try {
  await startAttestedRuntime({
    attest: () => attestRuntimeSchema(db),
    start: async (runtime) => {
      assertAttestedRuntimeCapabilities(runtime, {});
      await import('./runAccountDeletionWorker.js');
    },
  });
} catch (error: unknown) {
  await closeDatabasePool();
  throw error;
}
