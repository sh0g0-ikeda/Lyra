import { describe, expect, it } from 'vitest';

import {
  decodeListCursor,
  encodeListCursor,
  normalizeListPageLimit,
} from '../../../src/domain/pagination.js';

const id = '11111111-1111-4111-8111-111111111111';

describe('opaque list cursor', () => {
  it('endpoint kind・sort値・tie-breaker IDをbyte-stableに往復する', () => {
    const cursor = encodeListCursor('works', '2026-07-25T00:00:00.000Z', id);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeListCursor(cursor, 'works')).toEqual({
      sort: '2026-07-25T00:00:00.000Z',
      id,
    });
    expect(encodeListCursor('works', '2026-07-25T00:00:00.000Z', id)).toBe(cursor);
  });

  it('number sort値を保持する', () => {
    const cursor = encodeListCursor('pages', 42, id);
    expect(decodeListCursor(cursor, 'pages')).toEqual({ sort: 42, id });
  });

  it('別endpoint・壊れた値・過大値を拒否する', () => {
    const cursor = encodeListCursor('entities', '2026-07-25T00:00:00.000Z', id);

    expect(decodeListCursor(cursor, 'works')).toBeNull();
    expect(decodeListCursor('not-base64!', 'entities')).toBeNull();
    expect(decodeListCursor('a'.repeat(1025), 'entities')).toBeNull();
    expect(decodeListCursor(
      Buffer.from(JSON.stringify({ v: 1, k: 'entities', sort: 'x', id: 'not-uuid' }))
        .toString('base64url'),
      'entities',
    )).toBeNull();
  });

  it('limitを1..100へ正規化し未指定はnullで後方互換にする', () => {
    expect(normalizeListPageLimit(undefined)).toBeNull();
    expect(normalizeListPageLimit(1)).toBe(1);
    expect(normalizeListPageLimit(100)).toBe(100);
    expect(normalizeListPageLimit(0)).toBeNull();
    expect(normalizeListPageLimit(101)).toBeNull();
    expect(normalizeListPageLimit(2.5)).toBeNull();
  });
});
