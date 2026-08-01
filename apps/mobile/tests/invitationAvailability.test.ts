import { describe, expect, it } from 'vitest';

import { invitationUnavailableReason } from '@/domain/invitationAvailability';

const baseInput = {
  expiresAt: '2026-08-01T00:00:00.000Z',
  invitedEmail: 'invited@example.com',
  nowMs: Date.parse('2026-07-25T00:00:00.000Z'),
  signedInEmail: 'invited@example.com',
  status: 'pending' as const,
};

describe('invitationUnavailableReason', () => {
  it('有効なpending招待は利用可能にする', () => {
    expect(invitationUnavailableReason(baseInput)).toBeNull();
  });

  it.each([
    ['accepted', 'accepted'],
    ['revoked', 'revoked'],
    ['expired', 'expired'],
  ] as const)('%s状態を個別理由で返す', (status, expected) => {
    expect(invitationUnavailableReason({ ...baseInput, status })).toBe(expected);
  });

  it('期限日時超過とログインメール不一致を区別する', () => {
    expect(
      invitationUnavailableReason({
        ...baseInput,
        nowMs: Date.parse('2026-08-02T00:00:00.000Z'),
      }),
    ).toBe('expired');
    expect(
      invitationUnavailableReason({
        ...baseInput,
        signedInEmail: 'other@example.com',
      }),
    ).toBe('email_mismatch');
  });

  it('メール比較は大文字小文字と前後空白を正規化する', () => {
    expect(
      invitationUnavailableReason({
        ...baseInput,
        signedInEmail: '  INVITED@EXAMPLE.COM ',
      }),
    ).toBeNull();
  });
});
