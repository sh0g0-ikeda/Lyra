import type { GenerationWorkerWarmPort } from './GenerationWorkerWarmService.js';
export interface PageGenerationWarmReadinessPort {
  assertReadyForWarmup(userId: string, pageId: string, organizationId?: string | null): Promise<void>;
}
/** Preparation changes only operational warm capacity. Actual enqueue rechecks
 * ownership, inputs and credits; no credits or jobs are reserved here. */
export class PageGenerationWarmupService {
  public constructor(private readonly readiness: PageGenerationWarmReadinessPort, private readonly warm: GenerationWorkerWarmPort | null) {}
  public async warmup(userId: string, pageId: string, organizationId: string | null): Promise<void> {
    if (this.warm === null) return;
    await this.readiness.assertReadyForWarmup(userId, pageId, organizationId);
    try { await this.warm.requestWarm(); }
    catch { console.warn('[generation-worker-warm] preparation unavailable; generation remains available'); }
  }
}
