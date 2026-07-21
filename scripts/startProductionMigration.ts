import { loadRuntimeSecretEnv } from '../src/lib/runtimeSecretEnv.js';

await loadRuntimeSecretEnv();
await import('./migrate.js');
