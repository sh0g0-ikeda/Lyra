import type { StoryEpisodeImprovementRecord } from '@/domain/types';

export const shouldOverwritePageSkeleton = (existingPageCount: number): boolean =>
  existingPageCount > 0;

export const extractImprovedFullStory = (
  improvement: StoryEpisodeImprovementRecord
): string => {
  const fullDraft = improvement.draft.story_full_draft?.trim() ?? '';
  if (fullDraft.length > 0) {
    return fullDraft;
  }

  return [
    improvement.draft.introduction,
    improvement.draft.middle,
    improvement.draft.climax,
    improvement.draft.ending_hook
  ]
    .filter((part): part is string => part !== null && part.trim().length > 0)
    .map((part) => part.trim())
    .join('\n\n');
};
