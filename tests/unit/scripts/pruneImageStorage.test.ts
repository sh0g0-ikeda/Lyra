import { describe, expect, it } from 'vitest';
import { parsePruneImageStorageArgs } from '../../../scripts/pruneImageStorage.js';

describe('parsePruneImageStorageArgs', () => {
  it('uses tmp and session prefixes in dry-run mode by default', () => {
    expect(parsePruneImageStorageArgs([])).toEqual({
      prefixes: ['tmp/', 'session/'],
      olderThanHours: 24,
      protectRecentCandidateHours: 48,
      maxDeletes: 500,
      apply: false,
    });
  });

  it('parses prefix and apply flags', () => {
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

  it('deduplicates repeated prefixes', () => {
    expect(parsePruneImageStorageArgs(['--prefix', 'session/', '--prefix', 'session/']).prefixes).toEqual([
      'session/',
    ]);
  });

  it('rejects invalid numeric values', () => {
    expect(() => parsePruneImageStorageArgs(['--older-than-hours', '0'])).toThrow(
      /--older-than-hours must be a positive integer/,
    );
  });
});
