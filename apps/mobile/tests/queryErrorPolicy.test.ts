import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';
import {
  currentQueryError,
  supportingQueryError,
} from '@/lib/queryErrorPolicy';

describe('queryErrorPolicy', () => {
  it('利用可能なデータがある再取得エラーは表示しない', () => {
    const error = new ApiError('busy', 429, 'RATE_LIMITED');

    expect(currentQueryError({ data: { items: [1] }, enabled: true, error }))
      .toBeNull();
  });

  it('無効化された旧スコープのエラーは表示しない', () => {
    const error = new ApiError('missing', 404, 'NOT_FOUND');

    expect(currentQueryError({ data: undefined, enabled: false, error }))
      .toBeNull();
  });

  it('現在の必須取得にデータがない場合はエラーを返す', () => {
    const error = new ApiError('missing', 404, 'NOT_FOUND');

    expect(currentQueryError({ data: undefined, enabled: true, error }))
      .toBe(error);
  });

  it('補助取得の404はページ全体のエラーにしない', () => {
    const error = new ApiError('missing', 404, 'NOT_FOUND');

    expect(supportingQueryError({ data: undefined, enabled: true, error }))
      .toBeNull();
  });
});
