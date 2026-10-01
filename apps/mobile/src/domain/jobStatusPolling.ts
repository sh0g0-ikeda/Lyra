import type { GenerationJobCreditSettlementRecord } from '@/domain/types';

// A UI refresh budget, not an estimated refund completion time. After this
// window the server's pending state stays visible with a manual read action.
export const refundStatusRefreshWindowMs = 60_000;

export function jobStatusPollingInterval(input: {
  visible: boolean;
  status?: string;
  settlement?: GenerationJobCreditSettlementRecord['status'] | null;
  error?: boolean;
  now?: number;
  refundDeadline?: number | null;
}): number | false {
  if (!input.visible) return false;
  const terminal = input.status === 'completed' || input.status === 'failed' || input.status === 'canceled';
  if (terminal) {
    return input.settlement === 'refund_pending' &&
      (input.refundDeadline == null || (input.now ?? Date.now()) < input.refundDeadline)
      ? 5000 : false;
  }
  return input.error ? 5000 : 2500;
}
