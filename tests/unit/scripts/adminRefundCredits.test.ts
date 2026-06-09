import { describe, expect, it } from 'vitest';
import { parseAdminRefundCreditsArgs } from '../../../scripts/adminRefundCredits.js';

const userId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';

describe('parseAdminRefundCreditsArgs', () => {
  it('parses dry-run mode by default', () => {
    const result = parseAdminRefundCreditsArgs(['--user-id', userId, '--amount', '3']);

    expect(result).toEqual({
      userId,
      amount: 3,
      reason: 'Manual admin credit refund',
      apply: false,
    });
  });

  it('parses apply mode with job id and reason', () => {
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

  it('rejects non UUID user ids', () => {
    expect(() => parseAdminRefundCreditsArgs(['--user-id', 'bad', '--amount', '1'])).toThrow(
      /--user-id must be a UUID/,
    );
  });

  it('rejects unknown options', () => {
    expect(() => parseAdminRefundCreditsArgs([
      '--user-id',
      userId,
      '--amount',
      '1',
      '--amunt',
      '2',
    ])).toThrow(/Unknown option: --amunt/);
  });

  it('rejects duplicate scalar options', () => {
    expect(() => parseAdminRefundCreditsArgs([
      '--user-id',
      userId,
      '--amount',
      '1',
      '--amount',
      '2',
    ])).toThrow(/Duplicate option: --amount/);
  });

  it('rejects unsafe integer amounts', () => {
    expect(() => parseAdminRefundCreditsArgs([
      '--user-id',
      userId,
      '--amount',
      '9007199254740992',
    ])).toThrow(/--amount must be a positive integer/);
  });

  it('rejects unusually large manual refund amounts', () => {
    expect(() => parseAdminRefundCreditsArgs([
      '--user-id',
      userId,
      '--amount',
      '10001',
    ])).toThrow(/--amount must be 10000 or less/);
  });

  it('rejects non decimal integer amounts', () => {
    expect(() => parseAdminRefundCreditsArgs([
      '--user-id',
      userId,
      '--amount',
      '1e3',
    ])).toThrow(/--amount must be a positive integer/);
  });

  it('keeps dry-run mode when both dry-run and apply are present', () => {
    const result = parseAdminRefundCreditsArgs([
      '--user-id',
      userId,
      '--amount',
      '1',
      '--apply',
      '--dry-run',
    ]);

    expect(result.apply).toBe(false);
  });
});
