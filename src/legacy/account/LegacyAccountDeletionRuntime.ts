import type { LegacyAccountDeletionServiceAdapter } from './LegacyAccountDeletionServiceAdapter.js';

export interface LegacyAccountDeletionRecoveryResult {
  attemptedCount: number;
  completedCount: number;
  skipped: boolean;
}

export class LegacyAccountDeletionRuntime {
  private running = false;

  public constructor(
    private readonly service: Pick<LegacyAccountDeletionServiceAdapter, 'recoverPendingRequests'>,
    private readonly batchSize: number,
  ) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      throw new Error('Legacy account deletion recovery batch size must be between 1 and 100');
    }
  }

  public async runOnce(): Promise<LegacyAccountDeletionRecoveryResult> {
    if (this.running) return { attemptedCount: 0, completedCount: 0, skipped: true };
    this.running = true;
    try {
      return { ...await this.service.recoverPendingRequests(this.batchSize), skipped: false };
    } finally {
      this.running = false;
    }
  }
}
