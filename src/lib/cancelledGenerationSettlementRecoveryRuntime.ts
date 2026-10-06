import { ENTITY_GENERATION_STALE_AFTER_MS, PAGE_GENERATION_STALE_AFTER_MS } from '../domain/constants/generation.js';
import { ConfigurationError } from '../domain/errors/index.js';
import { createCancelledGenerationSettlementRecoveryRepository } from '../repositories/CancelledGenerationSettlementRecoveryRepository.js';
import { CancelledGenerationSettlementRecoveryService } from '../services/job/CancelledGenerationSettlementRecoveryService.js';
import type { DatabaseClient, TransactionRunner } from './db.js';
import { isProduction44RepositorySchemaProfile } from '../repositories/RepositorySchemaProfile.js';

const DEFAULT_INTERVAL_MS = Math.min(PAGE_GENERATION_STALE_AFTER_MS, ENTITY_GENERATION_STALE_AFTER_MS, 5 * 60 * 1000);
const MIN_INTERVAL_MS = 5_000;

/** Consumes a startup-selected profile; never re-reads the environment. The
 * canonical-only admission guard remains unchanged. Production44 is available
 * here only after the repository factory performs its exact DB attestation. */
export async function createCancelledGenerationSettlementRecoveryRuntime(
  database: DatabaseClient & TransactionRunner,
  profile: unknown,
): Promise<CancelledGenerationSettlementRecoveryRuntime | null> {
  if (profile === 'canonical') return null;
  if (!isProduction44RepositorySchemaProfile(profile)) throw new ConfigurationError('Unsupported cancelled settlement recovery profile');
  const repository = await createCancelledGenerationSettlementRecoveryRepository(database, profile);
  return new CancelledGenerationSettlementRecoveryRuntime(new CancelledGenerationSettlementRecoveryService(repository));
}

/** One service per process preserves the bounded keyset cursor across cycles.
 * stop closes admission synchronously and waits for the active DB work. */
export class CancelledGenerationSettlementRecoveryRuntime {
  private active: Promise<void> | null = null;
  private stopped = false;

  public constructor(private readonly service: Pick<CancelledGenerationSettlementRecoveryService, 'run'>) {}

  public run(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.active !== null) return this.active;
    this.active = this.recover().finally(() => { this.active = null; });
    return this.active;
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    await this.active;
  }

  private async recover(): Promise<void> {
    try {
      const result = await this.service.run();
      if (result.scanned > 0 || result.scanFailed || result.failed > 0) {
        console.info(JSON.stringify({ event: 'cancelled_generation_settlement_recovery', ...result }));
      }
    } catch {
      console.error('Cancelled generation settlement recovery failed; retry retained for the next cycle');
    }
  }
}

/** API lifecycle. The worker calls run on its existing recovery interval. */
export async function startCancelledGenerationSettlementRecoveryMaintenance(
  runtime: CancelledGenerationSettlementRecoveryRuntime | null,
  intervalMs = DEFAULT_INTERVAL_MS,
): Promise<() => Promise<void>> {
  if (runtime === null) return async () => undefined;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > DEFAULT_INTERVAL_MS) {
    throw new ConfigurationError('Invalid cancelled settlement recovery interval');
  }
  await runtime.run();
  const timer = setInterval(() => { void runtime.run(); }, intervalMs);
  timer.unref();
  return async () => { clearInterval(timer); await runtime.stop(); };
}
