import { loadRuntimeSecretEnv } from '../src/lib/runtimeSecretEnv.js';
import { assertTaskScaleInProtectionEnvironment } from '../worker/ecsTaskScaleInProtection.js';

await loadRuntimeSecretEnv();
assertTaskScaleInProtectionEnvironment(process.env);
await import('./runGenerationWorker.js');
