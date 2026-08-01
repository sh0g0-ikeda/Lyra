import { describe, expect, it } from 'vitest';

import {
  flattenUniqueRecords,
  MOBILE_LIST_PAGE_SIZE,
  nextCursorFromPage,
} from '@/lib/listPagination';

describe('Mobile list pagination', () => {
  it('ページ境界で重複したIDを最初の順序を保って除外する', () => {
    expect(
      flattenUniqueRecords([
        [{ id: 'one', value: 1 }, { id: 'two', value: 2 }],
        [{ id: 'two', value: 20 }, { id: 'three', value: 3 }],
      ]),
    ).toEqual([
      { id: 'one', value: 1 },
      { id: 'two', value: 2 },
      { id: 'three', value: 3 },
    ]);
  });

  it('次のcursorがある場合だけ追加ページを要求する', () => {
    expect(nextCursorFromPage({ next_cursor: 'opaque-next' })).toBe('opaque-next');
    expect(nextCursorFromPage({ next_cursor: null })).toBeUndefined();
    expect(MOBILE_LIST_PAGE_SIZE).toBeGreaterThanOrEqual(20);
    expect(MOBILE_LIST_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});
