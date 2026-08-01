import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { JobCreditSettlement } from '@/components/JobCreditSettlement';
import type { GenerationJobCreditSettlementRecord } from '@/domain/types';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view',
}));

const renderSettlement = (
  settlement: GenerationJobCreditSettlementRecord,
): string => {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<JobCreditSettlement language="ja" settlement={settlement} />);
  });
  return JSON.stringify(renderer!.toJSON());
};

describe('JobCreditSettlement', () => {
  it.each([
    ['not_charged', 0, 0, 0, '請求なし'],
    ['charged', 5, 0, 5, '5クレジット消費'],
    ['refunded', 5, 5, 0, '5クレジット返金済み'],
    ['partially_refunded', 5, 2, 3, '2クレジット返金済み・差引3クレジット'],
    ['refund_pending', 5, 0, 5, '返金状況を確認中'],
  ] as const)(
    'server status %s を推測せず表示する',
    (status, chargedCredits, refundedCredits, netCredits, expected) => {
      expect(
        renderSettlement({
          charged_credits: chargedCredits,
          refunded_credits: refundedCredits,
          net_credits: netCredits,
          status,
        }),
      ).toContain(expected);
    },
  );
});
