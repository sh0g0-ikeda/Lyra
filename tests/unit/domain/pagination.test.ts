import { describe, expect, it } from 'vitest';
import {
  decodeGenerationJobHistoryCursor,
  encodeGenerationJobHistoryCursor,
} from '../../../src/domain/pagination.js';

const cursor = {
  activeRank: 1 as const,
  createdAt: new Date('2026-07-31T00:00:00.000Z'),
  id: '33333333-3333-4333-8333-333333333333',
};

describe('generation job history cursor', () => {
  it('active rank・日時・IDをcanonical base64urlで往復する', () => {
    const encoded = encodeGenerationJobHistoryCursor(cursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeGenerationJobHistoryCursor(encoded)).toEqual(cursor);
  });

  it.each([
    ['別endpoint kind', { v: 1, k: 'entities', a: 1, c: cursor.createdAt.toISOString(), i: cursor.id }],
    ['version不一致', { v: 2, k: 'generation_job_history', a: 1, c: cursor.createdAt.toISOString(), i: cursor.id }],
    ['rank範囲外', { v: 1, k: 'generation_job_history', a: 2, c: cursor.createdAt.toISOString(), i: cursor.id }],
    ['不正日時', { v: 1, k: 'generation_job_history', a: 1, c: 'not-a-date', i: cursor.id }],
    ['不正UUID', { v: 1, k: 'generation_job_history', a: 1, c: cursor.createdAt.toISOString(), i: 'job-1' }],
  ])('%sを拒否する', (_name, payload) => {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    expect(() => decodeGenerationJobHistoryCursor(encoded)).toThrow(
      'cursor is invalid',
    );
  });

  it('非canonical・壊れたJSON・上限超過を拒否する', () => {
    const valid = encodeGenerationJobHistoryCursor(cursor);

    expect(() => decodeGenerationJobHistoryCursor(`${valid}=`)).toThrow(
      'cursor is invalid',
    );
    expect(() =>
      decodeGenerationJobHistoryCursor(
        Buffer.from('{', 'utf8').toString('base64url'),
      ),
    ).toThrow('cursor is invalid');
    expect(() => decodeGenerationJobHistoryCursor('a'.repeat(513))).toThrow(
      'cursor is invalid',
    );
  });
});
