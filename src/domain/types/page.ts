import type { PanelEntityAssignment } from './panelEntityAssignment.js';
import type { PageGenerationMode } from './pageGeneration.js';
import type { StyleReferenceMetadata } from './styleReference.js';
import type {
  PanelAngle,
  PanelDialogueLine,
  PanelRole,
  PanelShotType,
  PanelSize,
} from './panel.js';
import type { SceneEntityStateReference } from './scene.js';

export type PageStatus = 'designing' | 'generating' | 'generated' | 'editing' | 'confirmed';
export type PageDialogueMode = 'image_baked' | 'balloon_only' | 'mixed';

export interface GeneratedPageImage {
  s3Key: string | null;
  cdnUrl: string | null;
  generationMode: PageGenerationMode | null;
  generatedAt: string | null;
}

export interface PageGenerationPanelContext {
  panelId: string;
  entities: PanelEntityAssignment[];
}

export interface PageGenerationContext {
  pageId: string;
  workId: string;
  organizationId?: string | null;
  layoutConfig: Record<string, unknown>;
  generatedImage: GeneratedPageImage | null;
  generationMode: PageGenerationMode | null;
  status: PageStatus;
  frameCount: number;
  panels: PageGenerationPanelContext[];
}

export interface PagePromptContext {
  pageId: string;
  workId: string;
  organizationId?: string | null;
  pageNumber: number;
  episodePurpose: string | null;
  sceneSummaries: string[];
  storyPagePurpose: string | null;
  storyContinuityNote: string | null;
  layoutConfig: Record<string, unknown>;
  styleReference: StyleReferenceMetadata | null;
  dialogueMode: PageDialogueMode;
  pageDialogueToggle: boolean;
}

export interface PageAutofillSceneContext {
  id: string;
  order: number;
  location: string | null;
  time: string | null;
  atmosphere: string | null;
  involvedEntityIds: string[];
  entityStates: SceneEntityStateReference[];
}

export interface EpisodePagePlanSceneEntityStateContext extends SceneEntityStateReference {
  costumeNote: string | null;
  costumeRefId: string | null;
  conditionNote: string | null;
  hairNote: string | null;
  expressionDefault: string | null;
  extraNote: string | null;
}

export interface PageAutofillEntityContext {
  id: string;
  name: string;
  entityType: 'character' | 'nonhuman' | 'object';
  freeDescription: string | null;
  promptSupplement: string | null;
  structuredFields: Record<string, unknown>;
}

export interface PageAutofillPanelContext {
  id: string;
  order: number;
  panelRole: PanelRole;
  panelSize: PanelSize;
  situationText: string | null;
  composition: {
    source: 'gallery' | 'custom' | 'ai_auto';
    galleryItemId: string | null;
    compositionPrompt: string | null;
    shotType: PanelShotType | null;
    angle: PanelAngle | null;
    customNote: string | null;
  };
  dialogueInPanel: boolean;
  dialogue: PanelDialogueLine[];
  sfxText: string | null;
  backgroundNote: string | null;
  panelNotes: string | null;
  entities: PanelEntityAssignment[];
}

export interface PageAutofillContext {
  pageId: string;
  workId: string;
  episodeId: string;
  chapterId: string;
  pageNumber: number;
  totalPagesInEpisode: number;
  frameCount: number;
  status: PageStatus;
  dialogueMode: PageDialogueMode;
  pageDialogueToggle: boolean;
  chapterTitle: string | null;
  chapterPurpose: string | null;
  chapterStartingState: string | null;
  chapterEndingState: string | null;
  chapterEmotionCurve: string | null;
  chapterKeyBeats: string[];
  episodePurpose: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
  scenes: PageAutofillSceneContext[];
  entities: PageAutofillEntityContext[];
  panels: PageAutofillPanelContext[];
}

export interface EpisodePagePlanContext {
  episodeId: string;
  workId: string;
  chapter: {
    id: string;
    title: string | null;
    purpose: string | null;
    startingState: string | null;
    endingState: string | null;
    emotionCurve: string | null;
    keyBeats: string[];
  };
  episode: {
    title: string | null;
    purpose: string | null;
    introduction: string | null;
    middle: string | null;
    climax: string | null;
    endingHook: string | null;
    estimatedPages: number;
  };
  scenes: Array<
    Omit<PageAutofillSceneContext, 'entityStates'> & {
      entityStates: EpisodePagePlanSceneEntityStateContext[];
    }
  >;
  entities: PageAutofillEntityContext[];
  pages: Array<{
    pageId: string;
    pageNumber: number;
    frameCount: number;
    layoutConfig: Record<string, unknown>;
    status: PageStatus;
    dialogueMode: PageDialogueMode;
    pageDialogueToggle: boolean;
    panels: PageAutofillPanelContext[];
  }>;
}

export interface PageSummary {
  id: string;
  episodeId: string;
  pageNumber: number;
  layoutConfig: Record<string, unknown>;
  storySourceSceneIds: string[];
  storyPagePurpose: string | null;
  storyContinuityNote: string | null;
  dialogueMode: PageDialogueMode;
  pageDialogueToggle: boolean;
  generationMode: PageGenerationMode | null;
  generatedImage: GeneratedPageImage | null;
  status: PageStatus;
  panelCount: number;
  frameCount: number;
  balloonCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PageGenerationStateUpdate {
  status: PageStatus;
  generationMode: PageGenerationMode | null;
  expectedStatus?: PageStatus;
}

export interface UpdatePageSettingsInput {
  dialogueMode?: PageDialogueMode;
  pageDialogueToggle?: boolean;
  styleReference?: Record<string, unknown> | null;
  storySourceSceneIds?: string[];
  storyPagePurpose?: string | null;
  storyContinuityNote?: string | null;
  layoutConfig?: Record<string, unknown>;
}

export interface PageAutofillPanelSuggestion {
  order: number;
  panelRole?: PanelRole;
  panelSize?: PanelSize;
  situationText?: string | null;
  composition?: {
    source?: 'gallery' | 'custom' | 'ai_auto';
    galleryItemId?: string | null;
    compositionPrompt?: string | null;
    shotType?: PanelShotType | null;
    angle?: PanelAngle | null;
    customNote?: string | null;
  };
  dialogueInPanel?: boolean;
  dialogue?: PanelDialogueLine[];
  sfxText?: string | null;
  backgroundNote?: string | null;
  panelNotes?: string | null;
  entities?: PanelEntityAssignment[];
}

export interface PageAutofillSuggestion {
  page?: {
    dialogueMode?: PageDialogueMode;
    pageDialogueToggle?: boolean;
  };
  panels: PageAutofillPanelSuggestion[];
}

export interface EpisodePagePlanPageSuggestion {
  pageId: string;
  pageNumber: number;
  sourceSceneIds?: string[];
  pagePurpose?: string | null;
  continuityNote?: string | null;
  page?: {
    dialogueMode?: PageDialogueMode;
    pageDialogueToggle?: boolean;
  };
  panels: PageAutofillPanelSuggestion[];
}

export interface EpisodePagePlanSuggestion {
  pages: EpisodePagePlanPageSuggestion[];
}

export interface PageAutofillResult {
  updatedPanelCount: number;
  filledFieldCount: number;
  compilerUsed: boolean;
  compilerProvider: 'openai' | 'fallback';
  compilerModel: string | null;
  compilerPromptVersion: string | null;
  compilerError: string | null;
}

export interface EpisodePagePlanApplyResult {
  updatedPageCount: number;
  updatedPanelCount: number;
  updatedAssignmentCount: number;
  filledFieldCount: number;
  compilerUsed: boolean;
  compilerProvider: 'openai' | 'fallback';
  compilerModel: string | null;
  compilerPromptVersion: string | null;
  compilerError: string | null;
}
