import * as SecureStore from 'expo-secure-store';
import * as StoreReview from 'expo-store-review';

import {
  recordReviewRequestAttempt,
  recordSuccessfulPageImageSave,
  type StoreReviewState
} from '@/domain/storeReviewPolicy';

const storeReviewStateKey = 'lyra.mobile.store-review.v1';

export interface StoreReviewAdapter {
  isAvailable: () => Promise<boolean>;
  loadState: () => Promise<unknown>;
  requestReview: () => Promise<void>;
  saveState: (state: StoreReviewState) => Promise<void>;
}

type StoreReviewErrorReporter = (error: unknown) => void;

/**
 * Serializes successful-save notifications so concurrent completions cannot race
 * the persisted frequency guard. Errors stay outside the completed save result.
 */
export function createSuccessfulPageImageSaveReviewRequester(
  adapter: StoreReviewAdapter,
  reportError: StoreReviewErrorReporter = (error) => {
    console.warn('Store review request failed after a successful page image save', error);
  }
): () => Promise<void> {
  let queue: Promise<void> = Promise.resolve();

  return (): Promise<void> => {
    const operation = queue.then(async () => {
      const decision = recordSuccessfulPageImageSave(await adapter.loadState());
      await adapter.saveState(decision.state);

      if (!decision.shouldRequestReview || !(await adapter.isAvailable())) {
        return;
      }

      // Persist before the native call because requestReview does not reveal whether
      // the operating system displayed a prompt, and repeated calls would be spammy.
      await adapter.saveState(recordReviewRequestAttempt(decision.state));
      await adapter.requestReview();
    });

    queue = operation.catch((error: unknown) => {
      try {
        reportError(error);
      } catch {
        // Diagnostics must never turn a completed image save into an unhandled rejection.
      }
    });
    return queue;
  };
}

const nativeStoreReviewAdapter: StoreReviewAdapter = {
  isAvailable: StoreReview.isAvailableAsync,
  loadState: async () => {
    const raw = await SecureStore.getItemAsync(storeReviewStateKey);
    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  },
  requestReview: StoreReview.requestReview,
  saveState: (state) => SecureStore.setItemAsync(storeReviewStateKey, JSON.stringify(state))
};

export const requestStoreReviewAfterSuccessfulPageImageSave =
  createSuccessfulPageImageSaveReviewRequester(nativeStoreReviewAdapter);
