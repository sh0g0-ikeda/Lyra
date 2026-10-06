import type { PushNotificationDeliveryService } from '../services/notification/PushNotificationDeliveryService.js';
export interface PushMaintenanceRuntime {
  deliveryService: Pick<PushNotificationDeliveryService, 'dispatchPending'>;
  intervalMs: number;
}
/** A consumer handover must stop new claims and await the complete in-flight
 * delivery batch before starting a replacement. Separate processes use DB leases. */
export function startPushNotificationMaintenance(runtime: PushMaintenanceRuntime | null): () => Promise<void> {
  if (runtime === null) return () => Promise.resolve();
  if (!Number.isSafeInteger(runtime.intervalMs) || runtime.intervalMs < 5000) throw new Error('Invalid push maintenance interval');
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  const dispatch = (): Promise<void> => {
    if (stopped || inFlight !== null) return inFlight ?? Promise.resolve();
    const work = (async (): Promise<void> => {
      try {
        const result = await runtime.deliveryService.dispatchPending();
        if (result.claimed > 0) console.info(JSON.stringify({ event: 'push_delivery_batch', ...result }));
      } catch {
        // Provider errors may contain credentials, tokens or raw response data.
        console.error('Push notification maintenance failed; delivery receipts retained');
      }
    })();
    inFlight = work;
    void work.then(() => { if (inFlight === work) inFlight = null; });
    return work;
  };
  void dispatch();
  const timer = setInterval(() => { void dispatch(); }, runtime.intervalMs);
  timer.unref();
  return (): Promise<void> => {
    stopped = true;
    clearInterval(timer);
    return inFlight ?? Promise.resolve();
  };
}
