export interface StoryNextStepInput {
  hasSelectedEpisode: boolean;
  hasUnsavedChanges: boolean;
  storyDraft: string;
}

export const shouldShowStoryNextStep = ({
  hasSelectedEpisode,
  hasUnsavedChanges,
  storyDraft
}: StoryNextStepInput): boolean =>
  hasSelectedEpisode && !hasUnsavedChanges && storyDraft.trim().length > 0;

export type CharacterWorkflowNextStep =
  | 'create-preview'
  | 'confirm-preview'
  | 'open-pages'
  | null;

export interface CharacterWorkflowNextStepInput {
  confirmedPreviewCount: number;
  hasActivePreviewJob: boolean;
  hasJustConfirmedPreview: boolean;
  hasPreviewCandidate: boolean;
  hasResolvedPreviewState: boolean;
  hasSavedCharacter: boolean;
  hasUnsavedChanges: boolean;
}

export const resolveCharacterWorkflowNextStep = ({
  confirmedPreviewCount,
  hasActivePreviewJob,
  hasJustConfirmedPreview,
  hasPreviewCandidate,
  hasResolvedPreviewState,
  hasSavedCharacter,
  hasUnsavedChanges
}: CharacterWorkflowNextStepInput): CharacterWorkflowNextStep => {
  if (!hasSavedCharacter) {
    return null;
  }
  if (hasPreviewCandidate) {
    return 'confirm-preview';
  }
  if (hasActivePreviewJob) {
    return null;
  }
  if (hasJustConfirmedPreview) {
    return 'open-pages';
  }
  if (!hasResolvedPreviewState || hasUnsavedChanges) {
    return null;
  }
  return confirmedPreviewCount > 0 ? 'open-pages' : 'create-preview';
};
