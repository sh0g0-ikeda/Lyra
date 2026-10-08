import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseStripeRecoveryBackfillArgs } from '../../../scripts/backfillStripeSubscriptionRecovery.js';

describe('Stripe旧subscription回収backfill CLI', () => {
  it('既定ではdry-runとして解析する', () => {
    const unresolvedId = randomUUID();
    expect(parseStripeRecoveryBackfillArgs([
      '--unresolved-id', unresolvedId,
      '--credits', '175',
      '--expires-at', '2026-11-01T00:00:00.000Z',
    ])).toEqual({
      unresolvedAdjustmentId: unresolvedId,
      grantedCredits: 175,
      grantExpiresAt: new Date('2026-11-01T00:00:00.000Z'),
      apply: false,
    });
  });

  it('--applyがある場合だけ書込modeにする', () => {
    expect(parseStripeRecoveryBackfillArgs([
      '--unresolved-id', randomUUID(),
      '--credits', '50',
      '--expires-at', '2026-11-01T00:00:00+09:00',
      '--apply',
    ]).apply).toBe(true);
  });

  it.each([
    ['--unresolved-id', randomUUID(), '--credits', '0', '--expires-at', '2026-11-01T00:00:00Z'],
    ['--unresolved-id', randomUUID(), '--credits', '100', '--expires-at', '2026-11-01'],
    ['--unresolved-id', randomUUID(), '--credits', '100', '--expires-at', 'invalid'],
    ['--unresolved-id', randomUUID(), '--credits', '100', '--expires-at', '2026-11-01T00:00:00Z', '--apply', '--dry-run'],
  ])('曖昧または危険な引数を拒否する', (...args) => {
    expect(() => parseStripeRecoveryBackfillArgs(args)).toThrow();
  });
});
