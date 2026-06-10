import { describe, expect, it } from 'vitest';
import { parsePruneRateLimitBucketsArgs } from '../../../scripts/pruneRateLimitBuckets.js';

describe('parsePruneRateLimitBucketsArgs', () => {
  it('デフォルトではdry-runで24時間より古いbucketを1000件まで対象にする', () => {
    expect(parsePruneRateLimitBucketsArgs([])).toEqual({
      olderThanHours: 24,
      maxDeletes: 1_000,
      apply: false,
    });
  });

  it('applyと削除条件を解釈する', () => {
    expect(parsePruneRateLimitBucketsArgs([
      '--older-than-hours',
      '72',
      '--max-deletes',
      '25',
      '--apply',
    ])).toEqual({
      olderThanHours: 72,
      maxDeletes: 25,
      apply: true,
    });
  });

  it('applyとdry-runが同時ならdry-runを優先する', () => {
    expect(parsePruneRateLimitBucketsArgs(['--apply', '--dry-run']).apply).toBe(false);
  });

  it('不正な数値を拒否する', () => {
    expect(() => parsePruneRateLimitBucketsArgs(['--older-than-hours', '0'])).toThrow(
      /--older-than-hours must be a positive integer/,
    );
    expect(() => parsePruneRateLimitBucketsArgs(['--max-deletes', '0'])).toThrow(
      /--max-deletes must be a positive integer/,
    );
  });

  it('未知のオプションを拒否する', () => {
    expect(() => parsePruneRateLimitBucketsArgs(['--prefix', 'webhook'])).toThrow(
      /Unknown option: --prefix/,
    );
  });

  it('過大な値を拒否する', () => {
    expect(() => parsePruneRateLimitBucketsArgs([
      '--older-than-hours',
      '8761',
    ])).toThrow(/--older-than-hours must be 8760 or less/);
    expect(() => parsePruneRateLimitBucketsArgs([
      '--max-deletes',
      '10001',
    ])).toThrow(/--max-deletes must be 10000 or less/);
  });
});
