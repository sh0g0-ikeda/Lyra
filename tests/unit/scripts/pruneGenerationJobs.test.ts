import { describe, expect, it } from 'vitest';
import { parsePruneGenerationJobsArgs } from '../../../scripts/pruneGenerationJobs.js';

describe('parsePruneGenerationJobsArgs', () => {
  it('デフォルトではdry-runで500件まで対象にする', () => {
    expect(parsePruneGenerationJobsArgs([])).toEqual({
      maxDeletes: 500,
      apply: false,
    });
  });

  it('applyとmax-deletesを解釈する', () => {
    expect(parsePruneGenerationJobsArgs(['--max-deletes', '25', '--apply'])).toEqual({
      maxDeletes: 25,
      apply: true,
    });
  });

  it('applyとdry-runが同時に指定された場合はdry-runを優先する', () => {
    expect(parsePruneGenerationJobsArgs(['--apply', '--dry-run']).apply).toBe(false);
  });

  it('不正な数値を拒否する', () => {
    expect(() => parsePruneGenerationJobsArgs(['--max-deletes', '0'])).toThrow(
      /--max-deletes must be a positive integer/,
    );
  });

  it('未知のオプションを拒否する', () => {
    expect(() => parsePruneGenerationJobsArgs(['--older-than-hours', '24'])).toThrow(
      /Unknown option: --older-than-hours/,
    );
  });

  it('重複した値オプションを拒否する', () => {
    expect(() => parsePruneGenerationJobsArgs([
      '--max-deletes',
      '10',
      '--max-deletes',
      '20',
    ])).toThrow(/Duplicate option: --max-deletes/);
  });

  it('安全でない整数を拒否する', () => {
    expect(() => parsePruneGenerationJobsArgs([
      '--max-deletes',
      '9007199254740992',
    ])).toThrow(/--max-deletes must be a positive integer/);
  });
});
