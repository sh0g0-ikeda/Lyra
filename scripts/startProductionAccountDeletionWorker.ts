import { loadRuntimeSecretEnv } from '../src/lib/runtimeSecretEnv.js';

await loadRuntimeSecretEnv();
await import('./runAccountDeletionWorker.js');
