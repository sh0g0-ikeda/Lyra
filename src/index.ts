import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { PostgresCreditRepository } from './repositories/CreditRepository.js';
import { PostgresEntityGenerationExecutionRepository } from './repositories/EntityGenerationExecutionRepository.js';
import { PostgresEntityGenerationRecoveryRepository } from './repositories/EntityGenerationRecoveryRepository.js';
import { PostgresPageGenerationExecutionRepository } from './repositories/PageGenerationExecutionRepository.js';
import { PostgresPageGenerationRecoveryRepository } from './repositories/PageGenerationRecoveryRepository.js';
import { PostgresOrganizationRepository } from './repositories/OrganizationRepository.js';
import { CreditService } from './services/credit/CreditService.js';
import { EntityGenerationRecoveryService } from './services/entity/EntityGenerationRecoveryService.js';
import { PageGenerationRecoveryService } from './services/page/PageGenerationRecoveryService.js';
import { OrganizationService } from './services/organization/OrganizationService.js';
import { db } from './lib/db.js';
import { env } from './lib/env.js';
import { runPendingMigrations } from './lib/migrations.js';
import { assertProductionRuntimeConfig } from './lib/runtimeGuards.js';
import { sanitizePersistedErrorMessage } from './lib/errorSanitizer.js';

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

  try {
    const creditService = new CreditService(new PostgresCreditRepository(db, db));
    const recoveredCount = await new PageGenerationRecoveryService(
      new PostgresPageGenerationRecoveryRepository(db),
      new PostgresPageGenerationExecutionRepository(db),
      creditService,
      undefined,
      undefined,
      organizationService,
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

void main();
