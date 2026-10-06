import { GENERATION_RECOVERY_BATCH_LIMIT } from '../../domain/constants/generation.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import { isProduction44RepositorySchemaProfile } from '../../repositories/RepositorySchemaProfile.js';
import type {
  TerminalGenerationNotificationRecoveryRepository,
  TerminalNotificationRecoveryEnqueueOutcome,
} from '../../repositories/TerminalGenerationNotificationRecoveryRepository.js';

export interface TerminalGenerationNotificationRecoveryResult {
  scanned: number;
  inserted: number;
  existing: number;
  deferred: number;
  failed: number;
  wrapped: boolean;
  scanFailed: boolean;
  stopped: boolean;
}

/** A single process instance retains its UUID cursor. stop closes admission
 * synchronously and drains the active batch; a later runtime owns scheduling. */
export class TerminalGenerationNotificationRecoveryService {
  private afterId: string | null = null;
  private active: Promise<TerminalGenerationNotificationRecoveryResult> | null = null;
  private stopped = false;

  public constructor(
    private readonly repository: TerminalGenerationNotificationRecoveryRepository,
    private readonly cutover: string,
    private readonly batchLimit = GENERATION_RECOVERY_BATCH_LIMIT,
  ) {
    if (!isProduction44RepositorySchemaProfile(repository.profile)
      || !isExactUtcTimestamp(cutover)
      || !Number.isSafeInteger(batchLimit)
      || batchLimit < 1
      || batchLimit > GENERATION_RECOVERY_BATCH_LIMIT) {
      throw new ConfigurationError('Invalid terminal notification recovery configuration');
    }
  }

  public run(): Promise<TerminalGenerationNotificationRecoveryResult> {
    if (this.stopped) return Promise.resolve(emptyResult(true));
    if (this.active !== null) return this.active;
    const work = this.recover();
    this.active = work;
    void work.then(
      () => { if (this.active === work) this.active = null; },
      () => { if (this.active === work) this.active = null; },
    );
    return work;
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    await this.active;
  }

  private async recover(): Promise<TerminalGenerationNotificationRecoveryResult> {
    const result = emptyResult(false);
    let candidates: Array<{ jobId: string }>;
    try {
      candidates = await this.repository.scanBatch({
        cutover: this.cutover,
        afterId: this.afterId,
        limit: this.batchLimit,
      });
      if (candidates.length === 0 && this.afterId !== null) {
        result.wrapped = true;
        candidates = await this.repository.scanBatch({
          cutover: this.cutover,
          afterId: null,
          limit: this.batchLimit,
        });
        this.afterId = null;
      }
    } catch {
      result.scanFailed = true;
      return result;
    }

    for (const candidate of candidates.slice(0, this.batchLimit)) {
      // Poison and races cannot pin the cursor; failed rows are retried after wrap.
      this.afterId = candidate.jobId;
      result.scanned += 1;
      try {
        increment(result, await this.repository.enqueueCurrentTerminal(candidate.jobId));
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }
}

function emptyResult(stopped: boolean): TerminalGenerationNotificationRecoveryResult {
  return {
    scanned: 0,
    inserted: 0,
    existing: 0,
    deferred: 0,
    failed: 0,
    wrapped: false,
    scanFailed: false,
    stopped,
  };
}

function increment(
  result: TerminalGenerationNotificationRecoveryResult,
  outcome: TerminalNotificationRecoveryEnqueueOutcome,
): void {
  if (outcome === 'inserted') result.inserted += 1;
  else if (outcome === 'existing') result.existing += 1;
  else result.deferred += 1;
}

function isExactUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}
