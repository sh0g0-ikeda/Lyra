import { pathToFileURL } from 'node:url';
import { checkPreMobileMigrationDataInvariants } from './checkDeploymentDataInvariants.js';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';

async function main(): Promise<void> {
  const { loadRuntimeSecretEnv } = await import('../src/lib/runtimeSecretEnv.js');
  await loadRuntimeSecretEnv();

  const { closeDatabasePool, db } = await import('../src/lib/db.js');

  try {
    const report = await checkPreMobileMigrationDataInvariants(db);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      process.exitCode = 1;
    }
  } finally {
    await closeDatabasePool();
  }
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(
      sanitizePersistedErrorMessage(
        error,
        'Unknown pre-mobile-migration invariant check error',
      ),
    );
    process.exitCode = 1;
  });
}
