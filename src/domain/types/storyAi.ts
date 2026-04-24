import type { PanelRole, PanelSize } from './panel.js';
import type { PanelFrameTemplateId } from './panelFrame.js';

export type StoryCollaborationLayer = 'work' | 'chapter' | 'episode';

export interface StoryCollaborationContextInput {
  currentDraft: string | null;
  selectedText: string | null;
  userNotes: string | null;
  focusPoints: string[];
  constraints: string[];
}

export interface StoryCollaborationInput {
  layer: StoryCollaborationLayer;
  targetId: string;
  instruction: string;
  context: StoryCollaborationContextInput;
}

export interface StoryEntitySummary {
  id: string;
  name: string;
  entityType: string;
  freeDescription: string | null;
}

export interface StoryCollaborationTarget {
  layer: StoryCollaborationLayer;
  targetId: string;
  workId: string;
  workTitle: string;
  chapterTitle: string | null;
  episodeTitle: string | null;
  payload: Record<string, string | number | boolean | string[] | null>;
  entities: StoryEntitySummary[];
}

export interface PageSkeletonPanelDraft {
  order: number;
  panelRole: PanelRole;
  suggestedSize: PanelSize;
  situationHint: string;
  suggestedEntities: string[];
  suggestedDialogueHint: string | null;
}

export interface PageSkeletonPageDraft {
  pageNumber: number;
  purpose: string;
  suggestedPanelCount: number;
  suggestedLayout: PanelFrameTemplateId;
  panels: PageSkeletonPanelDraft[];
}

export interface EpisodePageSkeletonContext {
  episodeId: string;
  chapterId: string;
  workId: string;
  workTitle: string;
  workGenre: string | null;
  worldSetting: string | null;
  theme: string | null;
  chapterTitle: string | null;
  chapterPurpose: string | null;
  episodeTitle: string | null;
  episodePurpose: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
  estimatedPages: number;
  entitiesInvolved: string[];
  pageSkeletonGenerated: boolean;
  existingPageCount: number;
  entities: StoryEntitySummary[];
}

export interface PageSkeletonPersistResult {
  pagesCreated: number;
  panelsCreated: number;
}
