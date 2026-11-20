import { describe, expect, it } from 'vitest';

import { mayApplyStoryPageEstimate } from '@/lib/storyPageEstimateGuard';

describe('mayApplyStoryPageEstimate', () => {
  it('同じ話と下書きの場合に推定結果を反映する', () => {
    expect(mayApplyStoryPageEstimate(
      { scope: 'session:personal:episode-a', revision: 'draft-1' },
      { scope: 'session:personal:episode-a', revision: 'draft-1' },
    )).toBe(true);
  });

  it('話または下書きが変わった場合に古い推定結果を破棄する', () => {
    expect(mayApplyStoryPageEstimate(
      { scope: 'session:personal:episode-a', revision: 'draft-1' },
      { scope: 'session:personal:episode-b', revision: 'draft-1' },
    )).toBe(false);
    expect(mayApplyStoryPageEstimate(
      { scope: 'session:personal:episode-a', revision: 'draft-1' },
      { scope: 'session:personal:episode-a', revision: 'draft-2' },
    )).toBe(false);
  });
});
