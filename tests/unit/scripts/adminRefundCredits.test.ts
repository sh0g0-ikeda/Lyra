import { describe, expect, it } from 'vitest';
import { parseAdminRefundCreditsArgs } from '../../../scripts/adminRefundCredits.js';

const userId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';

describe('parseAdminRefundCreditsArgs', () => {
  it('デフォルトは dry-run として解析する', () => {
    const result = parseAdminRefundCreditsArgs(['--user-id', userId, '--amount', '3']);

    expect(result).toEqual({
      userId,
      amount: 3,
      reason: 'Manual admin credit refund',
      apply: false,
    });
  });

  it('apply と job_id と reason を解析する', () => {
    const result = parseAdminRefundCreditsArgs([
      '--user-id',
      userId,
      '--amount',
      '5',
      '--reason',
      'support refund',
      '--job-id',
      jobId,
      '--apply',
    ]);

    expect(result).toEqual({
      userId,
      amount: 5,
      reason: 'support refund',
      jobId,
      apply: true,
    });
  });

  it('UUID ではない user_id を拒否する', () => {
    expect(() => parseAdminRefundCreditsArgs(['--user-id', 'bad', '--amount', '1'])).toThrow(
      /--user-id must be a UUID/,
    );
  });
});
