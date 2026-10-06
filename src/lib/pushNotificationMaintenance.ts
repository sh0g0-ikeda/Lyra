import type { PushNotificationDeliveryService } from '../services/notification/PushNotificationDeliveryService.js';
export interface PushMaintenanceRuntime {
  deliveryService: Pick<PushNotificationDeliveryService, 'dispatchPending'>;
  intervalMs: number;
}
/** Provider transports are injected by the enabled runtime. Per-process overlap
 * is prohibited; separate API replicas coordinate through DB leases. */
export function startPushNotificationMaintenance(runtime: PushMaintenanceRuntime | null): () => void {
  if (runtime === null) return () => undefined;
  if (!Number.isSafeInteger(runtime.intervalMs) || runtime.intervalMs < 5000) throw new Error('Invalid push maintenance interval');
  let active = false;
  let stopped = false;
  const dispatch = async (): Promise<void> => {
    if (active || stopped) return;
    active = true;
    try {
      const result = await runtime.deliveryService.dispatchPending();
      if (result.claimed > 0) console.info(JSON.stringify({ event: 'push_delivery_batch', ...result }));
    } catch {
      // Provider errors may contain credentials, tokens or raw response data.
      console.error('Push notification maintenance failed; delivery receipts retained');
    } finally { active = false; }
  };
  void dispatch();
  const timer = setInterval(() => { void dispatch(); }, runtime.intervalMs);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
