import { describe, expect, it } from 'vitest';
import { jobStatusPollingInterval } from '@/domain/jobStatusPolling';

describe('jobStatusPollingInterval', () => {
  it('refund_pendingのterminalだけ自動window内で確認し、完了時と期限後は停止する', () => {
    const base = { visible: true, status: 'failed', settlement: 'refund_pending', now: 10, refundDeadline: 20 } as const;
    expect(jobStatusPollingInterval(base)).toBe(5000);
    expect(jobStatusPollingInterval({ ...base, now: 20 })).toBe(false);
    expect(jobStatusPollingInterval({ ...base, settlement: 'refunded' })).toBe(false);
    expect(jobStatusPollingInterval({ ...base, settlement: null })).toBe(false);
    expect(jobStatusPollingInterval({ ...base, visible: false })).toBe(false);
  });
  it('既存active cadenceとerror cadenceを保持し、inactiveでは停止する', () => {
    expect(jobStatusPollingInterval({ visible: true, status: 'processing' })).toBe(2500);
    expect(jobStatusPollingInterval({ visible: true, error: true })).toBe(5000);
    expect(jobStatusPollingInterval({ visible: false, status: 'processing' })).toBe(false);
  });
});
