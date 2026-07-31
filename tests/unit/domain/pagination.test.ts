import { describe, expect, it } from 'vitest';
import {
  decodeEntityListCursor,
  decodeGenerationJobHistoryCursor,
  decodeOrganizationListCursor,
  decodePageListCursor,
  decodeWorkListCursor,
  encodeEntityListCursor,
  encodeGenerationJobHistoryCursor,
  encodeOrganizationListCursor,
  encodePageListCursor,
  encodeWorkListCursor,
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

describe('work list cursor', () => {
  const workCursor = {
    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    createdAt: new Date('2026-07-30T00:00:00.000Z'),
    id: '44444444-4444-4444-8444-444444444444',
  };

  it('更新日時・作成日時・IDをcanonical base64urlで往復する', () => {
    const encoded = encodeWorkListCursor(workCursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeWorkListCursor(encoded)).toEqual(workCursor);
  });

  it.each([
    ['別endpoint kind', { v: 1, k: 'entities', u: workCursor.updatedAt.toISOString(), c: workCursor.createdAt.toISOString(), i: workCursor.id }],
    ['version不一致', { v: 2, k: 'works', u: workCursor.updatedAt.toISOString(), c: workCursor.createdAt.toISOString(), i: workCursor.id }],
    ['不正更新日時', { v: 1, k: 'works', u: 'invalid', c: workCursor.createdAt.toISOString(), i: workCursor.id }],
    ['非canonical作成日時', { v: 1, k: 'works', u: workCursor.updatedAt.toISOString(), c: '2026-07-30T09:00:00+09:00', i: workCursor.id }],
    ['不正UUID', { v: 1, k: 'works', u: workCursor.updatedAt.toISOString(), c: workCursor.createdAt.toISOString(), i: 'work-1' }],
  ])('%sを拒否する', (_name, payload) => {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    expect(() => decodeWorkListCursor(encoded)).toThrow('cursor is invalid');
  });
});

describe('entity list cursor', () => {
  const entityCursor = {
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    id: '55555555-5555-4555-8555-555555555555',
  };

  it('作成日時・IDをcanonical base64urlで往復する', () => {
    const encoded = encodeEntityListCursor(entityCursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeEntityListCursor(encoded)).toEqual(entityCursor);
  });

  it.each([
    ['別endpoint kind', { v: 1, k: 'works', c: entityCursor.createdAt.toISOString(), i: entityCursor.id }],
    ['version不一致', { v: 2, k: 'entities', c: entityCursor.createdAt.toISOString(), i: entityCursor.id }],
    ['非canonical日時', { v: 1, k: 'entities', c: '2026-07-31T09:00:00+09:00', i: entityCursor.id }],
    ['不正UUID', { v: 1, k: 'entities', c: entityCursor.createdAt.toISOString(), i: 'entity-1' }],
  ])('%sを拒否する', (_name, payload) => {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    expect(() => decodeEntityListCursor(encoded)).toThrow('cursor is invalid');
  });
});

describe('page list cursor', () => {
  const pageCursor = {
    pageNumber: 12,
    id: '66666666-6666-4666-8666-666666666666',
  };

  it('ページ番号・IDをcanonical base64urlで往復する', () => {
    const encoded = encodePageListCursor(pageCursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodePageListCursor(encoded)).toEqual(pageCursor);
  });

  it.each([
    ['別endpoint kind', { v: 1, k: 'entities', n: pageCursor.pageNumber, i: pageCursor.id }],
    ['version不一致', { v: 2, k: 'pages', n: pageCursor.pageNumber, i: pageCursor.id }],
    ['ページ番号0', { v: 1, k: 'pages', n: 0, i: pageCursor.id }],
    ['小数ページ番号', { v: 1, k: 'pages', n: 1.5, i: pageCursor.id }],
    ['不正UUID', { v: 1, k: 'pages', n: pageCursor.pageNumber, i: 'page-1' }],
  ])('%sを拒否する', (_name, payload) => {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    expect(() => decodePageListCursor(encoded)).toThrow('cursor is invalid');
  });
});

describe('organization list cursor', () => {
  const organizationCursor = {
    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    createdAt: new Date('2026-07-30T00:00:00.000Z'),
    id: '77777777-7777-4777-8777-777777777777',
  };

  it('更新日時・作成日時・IDをcanonical base64urlで往復する', () => {
    const encoded = encodeOrganizationListCursor(organizationCursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeOrganizationListCursor(encoded)).toEqual(organizationCursor);
  });

  it.each([
    ['別endpoint kind', { v: 1, k: 'works', u: organizationCursor.updatedAt.toISOString(), c: organizationCursor.createdAt.toISOString(), i: organizationCursor.id }],
    ['version不一致', { v: 2, k: 'organizations', u: organizationCursor.updatedAt.toISOString(), c: organizationCursor.createdAt.toISOString(), i: organizationCursor.id }],
    ['不正更新日時', { v: 1, k: 'organizations', u: 'invalid', c: organizationCursor.createdAt.toISOString(), i: organizationCursor.id }],
    ['非canonical作成日時', { v: 1, k: 'organizations', u: organizationCursor.updatedAt.toISOString(), c: '2026-07-30T09:00:00+09:00', i: organizationCursor.id }],
    ['不正UUID', { v: 1, k: 'organizations', u: organizationCursor.updatedAt.toISOString(), c: organizationCursor.createdAt.toISOString(), i: 'org-1' }],
  ])('%sを拒否する', (_name, payload) => {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    expect(() => decodeOrganizationListCursor(encoded)).toThrow(
      'cursor is invalid',
    );
  });
});
