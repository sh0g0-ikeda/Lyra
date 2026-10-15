import { describe, expect, it, vi } from 'vitest';
import type { StoreReviewState } from '@/domain/storeReviewPolicy';
import {
  createSuccessfulPageImageSaveReviewRequester,
  type StoreReviewAdapter
} from '@/lib/storeReview';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}));
vi.mock('expo-store-review', () => ({
  isAvailableAsync: vi.fn(),
  requestReview: vi.fn()
}));

function createAdapter(options: { available?: boolean } = {}): {
  adapter: StoreReviewAdapter;
  getState: () => unknown;
  requestReview: ReturnType<typeof vi.fn>;
  setAvailable: (available: boolean) => void;
} {
  let state: unknown = null;
  let available = options.available ?? true;
  const requestReview = vi.fn().mockResolvedValue(undefined);
  const adapter: StoreReviewAdapter = {
    isAvailable: vi.fn(async () => available),
    loadState: vi.fn(async () => state),
    requestReview,
    saveState: vi.fn(async (nextState: StoreReviewState) => {
      state = nextState;
    })
  };

  return {
    adapter,
    getState: () => state,
    requestReview,
    setAvailable: (nextAvailable) => {
      available = nextAvailable;
    }
  };
}

describe('store review request coordinator', () => {
  it('保存成功が3回に達するまでは評価APIを呼ばない', async () => {
    const { adapter, getState, requestReview } = createAdapter();
    const notifySaveSucceeded = createSuccessfulPageImageSaveReviewRequester(adapter);

    await notifySaveSucceeded();
    await notifySaveSucceeded();

    expect(getState()).toEqual({
      successfulPageImageSaves: 2,
      reviewRequestAttempted: false
    });
    expect(adapter.isAvailable).not.toHaveBeenCalled();
    expect(requestReview).not.toHaveBeenCalled();
  });

  it('3回目の保存成功後に試行済みを先に保存してから標準評価APIを一度だけ呼ぶ', async () => {
    const { adapter, getState, requestReview } = createAdapter();
    const notifySaveSucceeded = createSuccessfulPageImageSaveReviewRequester(adapter);

    await notifySaveSucceeded();
    await notifySaveSucceeded();
    await notifySaveSucceeded();
    await notifySaveSucceeded();

    expect(adapter.saveState).toHaveBeenNthCalledWith(3, {
      successfulPageImageSaves: 3,
      reviewRequestAttempted: false
    });
    expect(adapter.saveState).toHaveBeenNthCalledWith(4, {
      successfulPageImageSaves: 3,
      reviewRequestAttempted: true
    });
    expect(getState()).toEqual({
      successfulPageImageSaves: 3,
      reviewRequestAttempted: true
    });
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(adapter.saveState).mock.invocationCallOrder[3]
    ).toBeLessThan(requestReview.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
  });

  it('評価APIが利用できない環境では試行済みにせず、後の保存成功で再確認できる', async () => {
    const { adapter, requestReview, setAvailable } = createAdapter({ available: false });
    const notifySaveSucceeded = createSuccessfulPageImageSaveReviewRequester(adapter);

    await notifySaveSucceeded();
    await notifySaveSucceeded();
    await notifySaveSucceeded();
    expect(requestReview).not.toHaveBeenCalled();

    setAvailable(true);
    await notifySaveSucceeded();

    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it('評価APIの失敗を保存失敗として伝播せず、同じ利用者へ繰り返し依頼しない', async () => {
    const { adapter, requestReview } = createAdapter();
    requestReview.mockRejectedValueOnce(new Error('native review failed'));
    const reportError = vi.fn();
    const notifySaveSucceeded = createSuccessfulPageImageSaveReviewRequester(adapter, reportError);

    await notifySaveSucceeded();
    await notifySaveSucceeded();
    await expect(notifySaveSucceeded()).resolves.toBeUndefined();
    await notifySaveSucceeded();

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it('同時に通知された保存成功も直列化して数え、評価APIは一度だけ呼ぶ', async () => {
    const { adapter, getState, requestReview } = createAdapter();
    const notifySaveSucceeded = createSuccessfulPageImageSaveReviewRequester(adapter);

    await Promise.all([
      notifySaveSucceeded(),
      notifySaveSucceeded(),
      notifySaveSucceeded()
    ]);

    expect(getState()).toEqual({
      successfulPageImageSaves: 3,
      reviewRequestAttempted: true
    });
    expect(requestReview).toHaveBeenCalledTimes(1);
  });
});
