import { serve } from '@hono/node-server';
import { createApp, resolveConfiguredPageGenerationQueue } from './app.js';
import { PostgresCreditRepository } from './repositories/CreditRepository.js';
import { PostgresEntityGenerationExecutionRepository } from './repositories/EntityGenerationExecutionRepository.js';
import { PostgresEntityGenerationRecoveryRepository } from './repositories/EntityGenerationRecoveryRepository.js';
import { PostgresPageGenerationExecutionRepository } from './repositories/PageGenerationExecutionRepository.js';
import { PostgresPageGenerationRecoveryRepository } from './repositories/PageGenerationRecoveryRepository.js';
import { PostgresOrganizationRepository } from './repositories/OrganizationRepository.js';
import { PostgresExportJobRepository } from './repositories/ExportJobRepository.js';
import { CreditService } from './services/credit/CreditService.js';
import { EntityGenerationRecoveryService } from './services/entity/EntityGenerationRecoveryService.js';
import { PageGenerationRecoveryService } from './services/page/PageGenerationRecoveryService.js';
import { OrganizationService } from './services/organization/OrganizationService.js';
import { db } from './lib/db.js';
import { env } from './lib/env.js';
import {
  runEpisodeExportRuntimeWhenEnabled,
  type EnabledEpisodeExportRuntimeConfig,
} from './lib/episodeExportRuntime.js';
import { runPendingMigrations } from './lib/migrations.js';
import { assertProductionRuntimeConfig } from './lib/runtimeGuards.js';
import { sanitizePersistedErrorMessage } from './lib/errorSanitizer.js';
import { createPageImageStorageClient } from './infrastructure/aws/S3PageImageStorage.js';
import { S3ExportArtifactStorage } from './infrastructure/aws/S3ExportArtifactStorage.js';
import { createGenerationQueueClient } from './infrastructure/aws/SqsGenerationQueue.js';
import { SqsExportJobQueueAdapter } from './services/export/ExportJobQueue.js';
import { ExportOutboxDispatchService } from './services/export/ExportOutboxDispatchService.js';
import { ExportArtifactCleanupService } from './services/export/ExportArtifactCleanupService.js';
import { createPushNotificationDeliveryRuntime } from './infrastructure/push/PushNotificationRuntime.js';

const EXPORT_OUTBOX_INTERVAL_MS = 30_000;
const EXPORT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  assertProductionRuntimeConfig(env);

  if (env.AUTO_RUN_MIGRATIONS) {
    const appliedMigrations = await runPendingMigrations(db);
    if (appliedMigrations.length > 0) {
      console.warn(`[migrations] applied ${appliedMigrations.join(', ')}`);
    }
  } else {
    console.warn('[migrations] startup migration auto-run is disabled');
  }

  const organizationService = new OrganizationService(new PostgresOrganizationRepository(db, db));
  runEpisodeExportRuntimeWhenEnabled(env, startExportMaintenance);
  startPushNotificationMaintenance();

  try {
    const creditService = new CreditService(new PostgresCreditRepository(db, db));
    const recoveredCount = await new PageGenerationRecoveryService(
      new PostgresPageGenerationRecoveryRepository(db),
      new PostgresPageGenerationExecutionRepository(db),
      creditService,
      undefined,
      undefined,
      organizationService,
      resolveConfiguredPageGenerationQueue() ?? undefined,
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
      new PostgresEntityGenerationExecutionRepository(db),
      new CreditService(new PostgresCreditRepository(db, db)),
      undefined,
      undefined,
      organizationService,
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

  serve(
    {
      fetch: createApp().fetch,
      port: env.PORT,
    },
    (info) => {
      console.log(`Lyra API listening on http://localhost:${info.port}`);
    },
  );
}

function startPushNotificationMaintenance(): void {
  const runtime = createPushNotificationDeliveryRuntime(env, db);
  if (runtime === null) {
    return;
  }

  const dispatch = async (): Promise<void> => {
    try {
      const result = await runtime.deliveryService.dispatchPending();
      if (result.claimed > 0) {
        console.warn(
          `[push-delivery] claimed=${result.claimed} sent=${result.sent} retried=${result.retried} dead=${result.dead} stale=${result.stale}`,
        );
      }
    } catch (error) {
      console.error(
        '[push-delivery] maintenance failed',
        sanitizePersistedErrorMessage(error, 'Push notification delivery failed'),
      );
    }
  };

  void dispatch();
  setInterval(
    () => void dispatch(),
    env.PUSH_DELIVERY_INTERVAL_MS,
  ).unref();
}

function startExportMaintenance(runtimeConfig: EnabledEpisodeExportRuntimeConfig): void {
  const repository = new PostgresExportJobRepository(db, db);
  const storage = new S3ExportArtifactStorage(
    createPageImageStorageClient(env.AWS_REGION),
    { bucketName: runtimeConfig.S3_BUCKET_IMAGES },
  );
  const queue = new SqsExportJobQueueAdapter(
    createGenerationQueueClient(env.AWS_REGION),
    runtimeConfig.SQS_QUEUE_URL_GENERATION,
  );
  const outbox = new ExportOutboxDispatchService(repository, queue);
  const cleanup = new ExportArtifactCleanupService(repository, storage);

  const dispatch = async (): Promise<void> => {
    try {
      const result = await outbox.dispatchPending();
      if (result.dispatched > 0 || result.failed > 0) {
        console.warn(
          `[export-outbox] dispatched=${result.dispatched} failed=${result.failed}`,
        );
      }
    } catch (error) {
      console.error(
        '[export-outbox] maintenance failed',
        sanitizePersistedErrorMessage(error, 'Export outbox maintenance failed'),
      );
    }
  };
  const removeExpiredArtifacts = async (): Promise<void> => {
    try {
      const deleted = await cleanup.cleanupExpiredArtifacts();
      if (deleted > 0) {
        console.warn(`[export-cleanup] deleted=${deleted}`);
      }
    } catch (error) {
      console.error(
        '[export-cleanup] maintenance failed',
        sanitizePersistedErrorMessage(error, 'Export artifact cleanup failed'),
      );
    }
  };

  void dispatch();
  void removeExpiredArtifacts();
  setInterval(() => void dispatch(), EXPORT_OUTBOX_INTERVAL_MS).unref();
  setInterval(
    () => void removeExpiredArtifacts(),
    EXPORT_CLEANUP_INTERVAL_MS,
  ).unref();
}

void main();
