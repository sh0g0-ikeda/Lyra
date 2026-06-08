import { describe, expect, it } from 'vitest';
import { parsePruneImageStorageArgs } from '../../../scripts/pruneImageStorage.js';

describe('parsePruneImageStorageArgs', () => {
  it('デフォルトでは tmp と session を dry-run 対象にする', () => {
    expect(parsePruneImageStorageArgs([])).toEqual({
      prefixes: ['tmp/', 'session/'],
      olderThanHours: 24,
      protectRecentCandidateHours: 48,
      maxDeletes: 500,
      apply: false,
    });
  });

  it('prefix と apply を解析する', () => {
    expect(
      parsePruneImageStorageArgs([
        '--prefix',
        'session/',
        '--older-than-hours',
        '72',
        '--protect-recent-candidate-hours',
        '96',
        '--max-deletes',
        '10',
        '--apply',
      ]),
    ).toEqual({
      prefixes: ['session/'],
      olderThanHours: 72,
      protectRecentCandidateHours: 96,
      maxDeletes: 10,
      apply: true,
    });
  });

  it('不正な数値を拒否する', () => {
    expect(() => parsePruneImageStorageArgs(['--older-than-hours', '0'])).toThrow(
      /--older-than-hours must be a positive integer/,
    );
  });
});
