import { createAccountDeletionRecoveryRuntime, startAccountDeletionRecovery } from './infrastructure/account/AccountDeletionRuntime.js';
import { createEpisodeExportMaintenanceRuntime } from './lib/episodeExportMaintenanceRuntime.js';
import { startEpisodeExportMaintenance } from './lib/episodeExportMaintenance.js';
import { createPushNotificationDeliveryRuntime } from './infrastructure/push/PushNotificationRuntime.js';
import { startPushNotificationMaintenance } from './lib/pushNotificationMaintenance.js';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { PostgresCreditRepository } from './repositories/CreditRepository.js';
import { PostgresEntityGenerationExecutionRepository } from './repositories/EntityGenerationExecutionRepository.js';
import { PostgresEntityGenerationRecoveryRepository } from './repositories/EntityGenerationRecoveryRepository.js';
import { PostgresPageGenerationExecutionRepository } from './repositories/PageGenerationExecutionRepository.js';
import { PostgresPageGenerationRecoveryRepository } from './repositories/PageGenerationRecoveryRepository.js';
import { PostgresOrganizationRepository } from './repositories/OrganizationRepository.js';
import { PostgresGenerationJobRepository } from './repositories/GenerationJobRepository.js';
import { CreditService } from './services/credit/CreditService.js';
import { EntityGenerationRecoveryService } from './services/entity/EntityGenerationRecoveryService.js';
import { PageGenerationRecoveryService } from './services/page/PageGenerationRecoveryService.js';
import { OrganizationService } from './services/organization/OrganizationService.js';
import { closeDatabasePool, db } from './lib/db.js';
import { createCancelledGenerationSettlementRecoveryRuntime, startCancelledGenerationSettlementRecoveryMaintenance } from './lib/cancelledGenerationSettlementRecoveryRuntime.js';
import { env } from './lib/env.js';
import { runPendingMigrations } from './lib/migrations.js';
import { assertProductionRuntimeConfig, assertAttestedRuntimeCapabilities } from './lib/runtimeGuards.js';
import { createTerminalGenerationNotificationRecoveryRuntime, startTerminalGenerationNotificationRecoveryMaintenance } from './lib/terminalGenerationNotificationRecoveryRuntime.js';
import { prepareAttestedRuntimeSchema, startAttestedRuntime, type AttestedRuntime } from './lib/runtimeSchemaAttestation.js';
import { sanitizePersistedErrorMessage } from './lib/errorSanitizer.js';
import { createFencedStateReferenceRuntime } from './infrastructure/state/FencedStateReferenceRuntime.js';

async function main(): Promise<void> {
  assertProductionRuntimeConfig(env);
  await startAttestedRuntime({
    attest: prepareRuntimeSchema,
    start: startRuntime,
  });
}

async function prepareRuntimeSchema(): Promise<AttestedRuntime> {
  const schema = await prepareAttestedRuntimeSchema({
    database: db,
    autoRunMigrations: env.AUTO_RUN_MIGRATIONS,
    runMigrations: async () => runPendingMigrations(db),
  });
  if (schema.appliedMigrations.length > 0) {
    console.warn(`[migrations] applied ${schema.appliedMigrations.join(', ')}`);
  } else if (!env.AUTO_RUN_MIGRATIONS) {
    console.warn('[migrations] startup migration auto-run is disabled');
  }
  return schema.runtime;
}

async function startRuntime(runtime: AttestedRuntime): Promise<void> {
  assertAttestedRuntimeCapabilities(runtime, env);
  const terminalRecovery = await createTerminalGenerationNotificationRecoveryRuntime(db, runtime.repositoryProfile, {
    enabled: env.PUSH_NOTIFICATIONS_ENABLED, cutover: env.PUSH_TERMINAL_RECOVERY_CUTOVER, intervalMs: env.PUSH_DELIVERY_INTERVAL_MS,
  });
  const cancelledRecovery = await createCancelledGenerationSettlementRecoveryRuntime(db, runtime.repositoryProfile);
  const fencedStateReferenceRuntime = createFencedStateReferenceRuntime(env, db);

  const organizationService = new OrganizationService(new PostgresOrganizationRepository(db, db));
  const generationJobCancellationControl = new PostgresGenerationJobRepository(db, runtime.repositoryProfile);

  try {
    const creditService = new CreditService(new PostgresCreditRepository(db, db));
    const recoveredCount = await new PageGenerationRecoveryService(
      new PostgresPageGenerationRecoveryRepository(db),
      new PostgresPageGenerationExecutionRepository(db, runtime.repositoryProfile),
      creditService,
      undefined,
      undefined,
      organizationService,
      generationJobCancellationControl,
    ).recoverAllStaleJobs();

    if (recoveredCount > 0) {
      console.warn(`[page-generation-recovery] recovered ${recoveredCount} stale page generation job(s) on startup`);
    }
  } catch (error) {
    console.error(
      '[page-generation-recovery] failed to recover stale jobs on startup',
      sanitizePersistedErrorMessage(error, 'Page generation recovery failed'),
    );
  }

  try {
    const recoveredCount = await new EntityGenerationRecoveryService(
      new PostgresEntityGenerationRecoveryRepository(db),
      new PostgresEntityGenerationExecutionRepository(db, runtime.repositoryProfile),
      new CreditService(new PostgresCreditRepository(db, db)),
      undefined,
      undefined,
      organizationService,
      generationJobCancellationControl,
    ).recoverAllStaleJobs();

    if (recoveredCount > 0) {
      console.warn(`[entity-generation-recovery] recovered ${recoveredCount} stale entity generation job(s) on startup`);
    }
  } catch (error) {
    console.error(
      '[entity-generation-recovery] failed to recover stale jobs on startup',
      sanitizePersistedErrorMessage(error, 'Entity generation recovery failed'),
    );
  }

  const stopPush = startPushNotificationMaintenance(createPushNotificationDeliveryRuntime(env, db));
  const stopAccountDeletion = startAccountDeletionRecovery(createAccountDeletionRecoveryRuntime(env, db, fencedStateReferenceRuntime));
  const stopExports = startEpisodeExportMaintenance(createEpisodeExportMaintenanceRuntime(env, db));
  const stopCancelledRecovery = await startCancelledGenerationSettlementRecoveryMaintenance(cancelledRecovery);
  const stopTerminalRecovery = await startTerminalGenerationNotificationRecoveryMaintenance(terminalRecovery);

  const server = serve(
    {
      fetch: createApp({ fencedStateReferenceRuntime, attestedRuntime: runtime }).fetch,
      port: env.PORT,
    },
    (info) => {
      console.log(`Lyra API listening on http://localhost:${info.port}`);
    },
  );
  let shutdown: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (shutdown !== null) return shutdown;
    const httpClosed = new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) reject(error); else resolve(); });
    });
    shutdown = (async () => {
      // Stop scheduling before draining HTTP and recovery. No DB close can
      // overtake this reconciliation or an in-flight push dispatch.
      const drained = await Promise.allSettled([
        stopCancelledRecovery(), stopTerminalRecovery(), stopPush(), stopAccountDeletion(), stopExports(), httpClosed,
      ]);
      await closeDatabasePool();
      if (drained.some(result => result.status === 'rejected')) {
        console.error('API shutdown could not confirm all background work stopped');
        process.exitCode = 1;
      }
    })().catch(() => {
      console.error('API shutdown failed while draining background work');
      process.exitCode = 1;
    });
    return shutdown;
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
}

void main().catch(async (error: unknown) => {
  console.error(sanitizePersistedErrorMessage(error, 'API startup failed'));
  await closeDatabasePool();
  process.exitCode = 1;
});
