import type { EpisodeExportDispatchService } from '../services/export/EpisodeExportDispatchService.js';
import type { EpisodeExportCleanupService } from '../services/export/EpisodeExportCleanupService.js';
export interface EpisodeExportMaintenanceRuntime { dispatcher: Pick<EpisodeExportDispatchService, 'dispatchPending'>; cleanup: Pick<EpisodeExportCleanupService, 'cleanupExpired'>; }
/** Bounded recovery uses existing durable outbox/worker leases and owned-key
 * cleanup. Each task has a per-process overlap guard; errors retain receipts. */
export function startEpisodeExportMaintenance(runtime: EpisodeExportMaintenanceRuntime | null): () => void {
  if (runtime === null) return () => undefined;
  let stopped = false; let dispatching = false; let cleaning = false;
  const dispatch = async (): Promise<void> => {
    if (stopped || dispatching) return; dispatching = true;
    try { await runtime.dispatcher.dispatchPending(50); }
    catch { console.error('Episode export dispatch unavailable; outbox receipts retained'); }
    finally { dispatching = false; }
  };
  const cleanup = async (): Promise<void> => {
    if (stopped || cleaning) return; cleaning = true;
    try { await runtime.cleanup.cleanupExpired(100); }
    catch { console.error('Episode export cleanup unavailable; artifact receipts retained'); }
    finally { cleaning = false; }
  };
  void dispatch(); void cleanup();
  const dispatchTimer = setInterval(() => { void dispatch(); }, 30_000);
  const cleanupTimer = setInterval(() => { void cleanup(); }, 60 * 60 * 1000);
  dispatchTimer.unref(); cleanupTimer.unref();
  return () => { stopped = true; clearInterval(dispatchTimer); clearInterval(cleanupTimer); };
}
