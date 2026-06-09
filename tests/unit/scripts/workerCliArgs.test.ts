import { describe, expect, it } from 'vitest';
import {
  parseManualWorkerArgs,
  parseRetryPageGenerationArgs,
} from '../../../scripts/workerCliArgs.js';

const jobId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

describe('worker CLI argument parsing', () => {
  it('manual worker は job id を解釈する', () => {
    expect(parseManualWorkerArgs([jobId], 'worker:page')).toEqual({ jobId });
  });

  it('manual worker は job id 未指定を拒否する', () => {
    expect(() => parseManualWorkerArgs([], 'worker:page')).toThrow(
      /Usage: bun run worker:page -- <job-id>/,
    );
  });

  it('manual worker は余分な引数を拒否する', () => {
    expect(() => parseManualWorkerArgs([jobId, userId], 'worker:page')).toThrow(
      /Usage: bun run worker:page -- <job-id>/,
    );
  });

  it('manual worker は不正な UUID を worker queue に渡さない', () => {
    expect(() => parseManualWorkerArgs(['not-a-uuid'], 'worker:entity')).toThrow(
      /<job-id> must be a UUID/,
    );
  });

  it('retry worker は job id と user id を解釈する', () => {
    expect(parseRetryPageGenerationArgs([jobId, userId])).toEqual({ jobId, userId });
  });

  it('retry worker は user id 未指定を拒否する', () => {
    expect(() => parseRetryPageGenerationArgs([jobId])).toThrow(
      /Usage: bun run worker:retry -- <job-id> <user-id>/,
    );
  });

  it('retry worker は不正な job id を拒否する', () => {
    expect(() => parseRetryPageGenerationArgs(['not-a-uuid', userId])).toThrow(
      /<job-id> must be a UUID/,
    );
  });

  it('retry worker は不正な user id を拒否する', () => {
    expect(() => parseRetryPageGenerationArgs([jobId, 'not-a-uuid'])).toThrow(
      /<user-id> must be a UUID/,
    );
  });
});
