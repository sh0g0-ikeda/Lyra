import type { PanelRole, PanelSize } from './panel.js';
import type { PanelFrameTemplateId } from './panelFrame.js';
import type { AppLanguage } from './language.js';
import type { EpisodeStoryInputMode } from './story.js';

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
  language: AppLanguage;
  context: StoryCollaborationContextInput;
}

export interface StoryEpisodeDraftFields {
  title: string | null;
  purpose: string | null;
  storyInputMode: EpisodeStoryInputMode;
  storyFullDraft: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
}

export interface StoryEpisodeImprovementInput {
  episodeId: string;
  instruction: string;
  language: AppLanguage;
  baseDraft: StoryEpisodeDraftFields;
}

export interface StoryEpisodeImprovementContext {
  episodeId: string;
  chapterId: string;
  workId: string;
  workTitle: string;
  workGenre: string | null;
  worldSetting: string | null;
  theme: string | null;
  overallFlow: string | null;
  chapterTitle: string | null;
  chapterPurpose: string | null;
  chapterStartingState: string | null;
  chapterEndingState: string | null;
  chapterEmotionCurve: string | null;
  episodeTitle: string | null;
  episodePurpose: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
  estimatedPages: number;
  entities: StoryEntitySummary[];
  sceneSummaries: string[];
  chapterSummaries: string[];
  siblingEpisodeSummaries: string[];
}

export interface StoryEpisodeImprovementResult {
  draft: StoryEpisodeDraftFields;
  compilerProvider: 'openai' | 'fallback';
  compilerModel: string | null;
  compilerPromptVersion: string | null;
  compilerError: string | null;
}

export interface StoryEpisodeImprovementSectionPlan {
  objective: string | null;
  mustInclude: string[];
  visualBeats: string[];
  narrationHints: string[];
  continuityGuards: string[];
  avoid: string[];
}

export interface StoryEpisodeImprovementPlan {
  storyObjective: string | null;
  mustPreserve: string[];
  continuityGuards: string[];
  pageAdaptationNotes: string[];
  introduction: StoryEpisodeImprovementSectionPlan;
  middle: StoryEpisodeImprovementSectionPlan;
  climax: StoryEpisodeImprovementSectionPlan;
  endingHook: StoryEpisodeImprovementSectionPlan;
}

export interface StoryEpisodeImprovementAudit {
  verdict: 'pass' | 'revise';
  globalIssues: string[];
  introduction: string[];
  middle: string[];
  climax: string[];
  endingHook: string[];
}

export interface StoryEntitySummary {
  id: string;
  name: string;
  aliases: string[];
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
  sceneSummaries: string[];
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
  sceneSummaries: string[];
}

export interface PageSkeletonPersistResult {
  pagesCreated: number;
  panelsCreated: number;
  replacedExisting: boolean;
}
