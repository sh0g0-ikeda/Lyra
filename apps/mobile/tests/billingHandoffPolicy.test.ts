import { describe, expect, it, vi } from 'vitest';

import {
  billingConfirmationBackoffMs,
  billingSnapshotChanged,
  pollBillingConfirmation,
  type BillingAuthoritativeSnapshot
} from '@/domain/billingHandoffPolicy';

const snapshot = (
  patch: Partial<BillingAuthoritativeSnapshot> = {}
): BillingAuthoritativeSnapshot => ({
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-08-25T00:00:00.000Z',
  paidCreditInvoiceIds: [],
  paidSubscriptionInvoiceIds: [],
  planCode: 'enterprise_a',
  purchasedCredits: 0,
  subscriptionStatus: 'active',
  totalCredits: 100,
  ...patch
});

describe('billingHandoffPolicy', () => {
  it('契約checkoutは対象プランのauthoritativeな変更後だけ完了と判定する', () => {
    const before = snapshot();
    expect(
      billingSnapshotChanged(before, before, {
        kind: 'subscription',
        targetPlanCode: 'enterprise_b'
      })
    ).toBe(false);
    expect(
      billingSnapshotChanged(
        before,
        snapshot({
          currentPeriodEnd: '2026-09-25T00:00:00.000Z',
          planCode: 'enterprise_b'
        }),
        {
          kind: 'subscription',
          targetPlanCode: 'enterprise_b'
        }
      )
    ).toBe(true);
  });

  it('追加creditは新しい支払済み請求書または購入残高増加後だけ完了と判定する', () => {
    const before = snapshot();
    expect(billingSnapshotChanged(before, before, { kind: 'credits' })).toBe(false);
    expect(
      billingSnapshotChanged(
        before,
        snapshot({ paidCreditInvoiceIds: ['invoice-new'] }),
        { kind: 'credits' }
      )
    ).toBe(true);
    expect(
      billingSnapshotChanged(before, snapshot({ purchasedCredits: 200 }), {
        kind: 'credits'
      })
    ).toBe(true);
  });

  it('請求portalは契約情報が変化した場合だけ更新済みと判定する', () => {
    const before = snapshot();
    expect(billingSnapshotChanged(before, before, { kind: 'portal' })).toBe(false);
    expect(
      billingSnapshotChanged(before, snapshot({ cancelAtPeriodEnd: true }), {
        kind: 'portal'
      })
    ).toBe(true);
  });

  it('前面復帰後は即時確認してから有限の指数backoffで再取得する', async () => {
    const before = snapshot();
    const after = snapshot({
      paidCreditInvoiceIds: ['invoice-new'],
      purchasedCredits: 200,
      totalCredits: 300
    });
    const fetchSnapshot = vi
      .fn<() => Promise<BillingAuthoritativeSnapshot>>()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(
      pollBillingConfirmation({
        before,
        fetchSnapshot,
        intent: { kind: 'credits' },
        sleep
      })
    ).resolves.toMatchObject({ attempts: 3, status: 'confirmed' });
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual(
      billingConfirmationBackoffMs.slice(0, 2)
    );
  });

  it('cancel・戻る・timeoutで状態が変わらない場合は成功にせず有限回で終了する', async () => {
    const before = snapshot();
    const fetchSnapshot = vi
      .fn<() => Promise<BillingAuthoritativeSnapshot>>()
      .mockResolvedValue(before);
    const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(
      pollBillingConfirmation({
        before,
        fetchSnapshot,
        intent: { kind: 'credits' },
        sleep
      })
    ).resolves.toMatchObject({
      attempts: billingConfirmationBackoffMs.length + 1,
      status: 'unconfirmed'
    });
    expect(fetchSnapshot).toHaveBeenCalledTimes(billingConfirmationBackoffMs.length + 1);
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual(
      billingConfirmationBackoffMs
    );
  });
});
