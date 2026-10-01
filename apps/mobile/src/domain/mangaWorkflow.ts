import type { PersistedWorkspaceSelection } from '@/domain/types';

export type MangaCreationStep = 'story' | 'characters' | 'pages';

export const mangaCreationSteps: readonly MangaCreationStep[] = ['story', 'characters', 'pages'];

// Navigation only: saved work determines a useful resume point. This policy never
// saves, applies AI output, or starts paid generation (front design 05 §1).
export function resumeMangaStep(input: {
  savedStory: string;
  hasPages: boolean;
  hasEpisode: boolean;
}): MangaCreationStep {
  if (!input.hasEpisode) return 'story';
  if (input.hasPages) return 'pages';
  return input.savedStory.trim().length > 0 ? 'characters' : 'story';
}

export function mangaWorkflowScopeKey(
  sessionKey: string,
  selection: PersistedWorkspaceSelection
): string {
  return JSON.stringify([
    sessionKey,
    selection.organizationId,
    selection.workId,
    selection.chapterId,
    selection.episodeId
  ]);
}
