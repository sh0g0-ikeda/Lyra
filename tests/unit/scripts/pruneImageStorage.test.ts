import { describe, expect, it } from 'vitest';
import { parsePruneImageStorageArgs } from '../../../scripts/pruneImageStorage.js';

describe('parsePruneImageStorageArgs', () => {
  it('uses tmp and session prefixes in dry-run mode by default', () => {
    expect(parsePruneImageStorageArgs([])).toEqual({
      prefixes: ['tmp/', 'session/'],
      olderThanHours: 24,
      protectRecentCandidateHours: 48,
      maxDeletes: 500,
      maxScanned: 5000,
      apply: false,
      includeSavedUnreferenced: false,
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
        '--max-scanned',
        '250',
        '--include-saved-unreferenced',
        '--apply',
      ]),
    ).toEqual({
      prefixes: ['session/'],
      olderThanHours: 72,
      protectRecentCandidateHours: 96,
      maxDeletes: 10,
      maxScanned: 250,
      apply: true,
      includeSavedUnreferenced: true,
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

  it('rejects unknown options', () => {
    expect(() => parsePruneImageStorageArgs(['--older-than-hour', '24'])).toThrow(
      /Unknown option: --older-than-hour/,
    );
  });

  it('rejects duplicate scalar options', () => {
    expect(() => parsePruneImageStorageArgs([
      '--older-than-hours',
      '24',
      '--older-than-hours',
      '48',
    ])).toThrow(/Duplicate option: --older-than-hours/);
  });

  it('rejects unsafe integer values', () => {
    expect(() => parsePruneImageStorageArgs([
      '--max-deletes',
      '9007199254740992',
    ])).toThrow(/--max-deletes must be a positive integer/);
  });

  it('rejects non decimal integer values', () => {
    expect(() => parsePruneImageStorageArgs(['--older-than-hours', '1e3'])).toThrow(
      /--older-than-hours must be a positive integer/,
    );
  });

  it('keeps dry-run mode when both dry-run and apply are present', () => {
    expect(parsePruneImageStorageArgs(['--apply', '--dry-run']).apply).toBe(false);
  });
});
