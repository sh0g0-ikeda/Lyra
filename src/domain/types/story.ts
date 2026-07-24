export type StoryStatus = 'draft' | 'reviewing' | 'ready';
export type EpisodeStoryInputMode = 'structured' | 'full';
export type StoryItemMoveDirection = 'up' | 'down';

export interface Work {
  id: string;
  userId: string;
  organizationId?: string | null;
  title: string;
  genre: string | null;
  worldSetting: string | null;
  theme: string | null;
  mainEntityIds: string[];
  startingPoint: string | null;
  endingPoint: string | null;
  overallFlow: string | null;
  version: number;
  editHistory: Record<string, unknown>[];
  status: StoryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chapter {
  id: string;
  workId: string;
  order: number;
  title: string | null;
  purpose: string | null;
  startingState: string | null;
  endingState: string | null;
  emotionCurve: string | null;
  entitiesInvolved: string[];
  keyBeats: string[];
  version: number;
  editHistory: Record<string, unknown>[];
  status: StoryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Episode {
  id: string;
  chapterId: string;
  order: number;
  title: string | null;
  purpose: string | null;
  storyInputMode: EpisodeStoryInputMode;
  storyFullDraft: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
  estimatedPages: number;
  entitiesInvolved: string[];
  pageSkeletonGenerated: boolean;
  version: number;
  editHistory: Record<string, unknown>[];
  status: StoryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkInput {
  title: string;
  organizationId?: string | null;
  genre: string | null;
  worldSetting: string | null;
  theme: string | null;
  mainEntityIds: string[];
  startingPoint: string | null;
  endingPoint: string | null;
  overallFlow: string | null;
}

export interface UpdateWorkInput {
  expectedUpdatedAt: string;
  title?: string;
  genre?: string | null;
  worldSetting?: string | null;
  theme?: string | null;
  mainEntityIds?: string[];
  startingPoint?: string | null;
  endingPoint?: string | null;
  overallFlow?: string | null;
  status?: StoryStatus;
}

export interface CreateChapterInput {
  order: number;
  title: string | null;
  purpose: string | null;
  startingState: string | null;
  endingState: string | null;
  emotionCurve: string | null;
  entitiesInvolved: string[];
  keyBeats: string[];
}

export interface UpdateChapterInput {
  expectedUpdatedAt: string;
  order?: number;
  title?: string | null;
  purpose?: string | null;
  startingState?: string | null;
  endingState?: string | null;
  emotionCurve?: string | null;
  entitiesInvolved?: string[];
  keyBeats?: string[];
  status?: StoryStatus;
}

export interface CreateEpisodeInput {
  order: number;
  title: string | null;
  purpose: string | null;
  storyInputMode: EpisodeStoryInputMode;
  storyFullDraft: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
  estimatedPages: number;
  entitiesInvolved: string[];
}

export interface UpdateEpisodeInput {
  expectedUpdatedAt: string;
  order?: number;
  title?: string | null;
  purpose?: string | null;
  storyInputMode?: EpisodeStoryInputMode;
  storyFullDraft?: string | null;
  introduction?: string | null;
  middle?: string | null;
  climax?: string | null;
  endingHook?: string | null;
  estimatedPages?: number;
  entitiesInvolved?: string[];
  status?: StoryStatus;
}
