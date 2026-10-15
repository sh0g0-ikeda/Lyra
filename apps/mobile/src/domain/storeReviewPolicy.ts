const REVIEW_REQUEST_SAVE_THRESHOLD = 3;

export type StoreReviewState = {
  successfulPageImageSaves: number;
  reviewRequestAttempted: boolean;
};

export type StoreReviewDecision = {
  state: StoreReviewState;
  shouldRequestReview: boolean;
};

export const defaultStoreReviewState: StoreReviewState = {
  successfulPageImageSaves: 0,
  reviewRequestAttempted: false
};

function normalizedSuccessfulPageImageSaves(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(REVIEW_REQUEST_SAVE_THRESHOLD, Math.max(0, Math.floor(value)));
}

/** Treat persisted values as untrusted so a malformed value cannot trigger repeated prompts. */
export function sanitizeStoreReviewState(value: unknown): StoreReviewState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaultStoreReviewState };
  }

  const state = value as Partial<StoreReviewState>;
  return {
    successfulPageImageSaves: normalizedSuccessfulPageImageSaves(state.successfulPageImageSaves),
    reviewRequestAttempted: state.reviewRequestAttempted === true
  };
}

/** Call only after a page image save succeeds; failed saves must not advance this state. */
export function recordSuccessfulPageImageSave(value: unknown): StoreReviewDecision {
  const current = sanitizeStoreReviewState(value);
  const state: StoreReviewState = {
    ...current,
    successfulPageImageSaves: Math.min(
      REVIEW_REQUEST_SAVE_THRESHOLD,
      current.successfulPageImageSaves + 1
    )
  };

  return {
    state,
    shouldRequestReview:
      !state.reviewRequestAttempted &&
      state.successfulPageImageSaves >= REVIEW_REQUEST_SAVE_THRESHOLD
  };
}

export function recordReviewRequestAttempt(value: unknown): StoreReviewState {
  return {
    ...sanitizeStoreReviewState(value),
    reviewRequestAttempted: true
  };
}
