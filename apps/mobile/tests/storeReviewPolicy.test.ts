import { describe, expect, it } from 'vitest';

import {
  defaultStoreReviewState,
  recordReviewRequestAttempt,
  recordSuccessfulPageImageSave,
  sanitizeStoreReviewState
} from '@/domain/storeReviewPolicy';

describe('store review policy', () => {
  it.each([
    [0, 1, false],
    [1, 2, false],
    [2, 3, true],
    [3, 3, true]
  ])(
    'ページ画像の%d回目までの保存成功を数え、%d回目からだけ依頼対象にする',
    (successfulPageImageSaves, expectedSaves, shouldRequestReview) => {
      expect(recordSuccessfulPageImageSave({
        successfulPageImageSaves,
        reviewRequestAttempted: false
      })).toEqual({
        state: { successfulPageImageSaves: expectedSaves, reviewRequestAttempted: false },
        shouldRequestReview
      });
    }
  );

  it('依頼試行を記録した後は保存成功を重ねても再依頼しない', () => {
    const attempted = recordReviewRequestAttempt({
      successfulPageImageSaves: 3,
      reviewRequestAttempted: false
    });

    expect(attempted).toEqual({
      successfulPageImageSaves: 3,
      reviewRequestAttempted: true
    });
    expect(recordSuccessfulPageImageSave(attempted).shouldRequestReview).toBe(false);
  });

  it('壊れた保存値を初期状態へ安全に戻し、保存成功だけを一回として扱う', () => {
    expect(sanitizeStoreReviewState('not-state')).toEqual(defaultStoreReviewState);
    expect(recordSuccessfulPageImageSave('not-state')).toEqual({
      state: { successfulPageImageSaves: 1, reviewRequestAttempted: false },
      shouldRequestReview: false
    });
  });

  it('負数・小数・巨大値を安全な保存回数へ正規化する', () => {
    expect(sanitizeStoreReviewState({
      successfulPageImageSaves: -4,
      reviewRequestAttempted: 'yes'
    })).toEqual(defaultStoreReviewState);
    expect(sanitizeStoreReviewState({
      successfulPageImageSaves: 2.9,
      reviewRequestAttempted: false
    })).toEqual({ successfulPageImageSaves: 2, reviewRequestAttempted: false });
    expect(sanitizeStoreReviewState({
      successfulPageImageSaves: Number.MAX_VALUE,
      reviewRequestAttempted: false
    })).toEqual({ successfulPageImageSaves: 3, reviewRequestAttempted: false });
  });
});
