import { GENERATION_RECOVERY_BATCH_LIMIT } from '../../domain/constants/generation.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { CancelledGenerationSettlementRecoveryRepository, CancelledSettlementCandidate } from '../../repositories/CancelledGenerationSettlementRecoveryRepository.js';
import { isProduction44RepositorySchemaProfile } from '../../repositories/RepositorySchemaProfile.js';

export interface CancelledSettlementRecoveryResult {
  scanned: number;
  settled: number;
  skipped: number;
  deferred: number;
  failed: number;
  wrapped: boolean;
  scanFailed: boolean;
  busy: boolean;
}

/** C0 recovery port; not connected to startup/periodic execution yet.
 * The verified repository factory binds settlement to its own production44 DB.
 * The cursor is process-local: restart safely rescans from the beginning, but
 * frequent restarts can delay the tail of a large backlog. No durable progress
 * or recurring-execution guarantee is implied by this service alone. */
export class CancelledGenerationSettlementRecoveryService {
  private afterId: string | null = null;
  private inFlight = false;

  public constructor(
    private readonly repository: CancelledGenerationSettlementRecoveryRepository,
    private readonly batchLimit = GENERATION_RECOVERY_BATCH_LIMIT,
  ) {
    if (!isProduction44RepositorySchemaProfile(repository.profile)
      || !Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > GENERATION_RECOVERY_BATCH_LIMIT) {
      throw new ConfigurationError('Invalid cancelled settlement recovery configuration');
    }
  }

  public async run(): Promise<CancelledSettlementRecoveryResult> {
    const result: CancelledSettlementRecoveryResult = {
      scanned: 0, settled: 0, skipped: 0, deferred: 0, failed: 0,
      wrapped: false, scanFailed: false, busy: false,
    };
    if (this.inFlight) return { ...result, busy: true };
    this.inFlight = true;
    try {
      let rows: CancelledSettlementCandidate[];
      try {
        rows = await this.repository.scanBatch({ afterId: this.afterId, limit: this.batchLimit });
        if (rows.length === 0 && this.afterId !== null) {
          result.wrapped = true;
          rows = await this.repository.scanBatch({ afterId: null, limit: this.batchLimit });
          this.afterId = null;
        }
      } catch {
        result.scanFailed = true;
        return result;
      }
      for (const row of rows.slice(0, this.batchLimit)) {
        // Advance even when a row cannot settle; retry it on the next sweep.
        this.afterId = row.jobId;
        result.scanned += 1;
        if (!row.needsSettlement) { result.skipped += 1; continue; }
        try {
          if (await this.repository.settleAndVerify(row.jobId)) result.settled += 1;
          else result.deferred += 1;
        } catch {
          // Counts are observable without leaking SQL, ledger rows or raw errors.
          result.failed += 1;
        }
      }
      return result;
    } finally {
      this.inFlight = false;
    }
  }
}
