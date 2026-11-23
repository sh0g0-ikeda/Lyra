export interface StoryPageEstimateSnapshot {
  scope: string;
  revision: string;
}

/** Only an estimate for the still-visible, unchanged editor may update its page field. */
export function mayApplyStoryPageEstimate(
  submitted: StoryPageEstimateSnapshot,
  current: StoryPageEstimateSnapshot,
): boolean {
  return submitted.scope === current.scope && submitted.revision === current.revision;
}
