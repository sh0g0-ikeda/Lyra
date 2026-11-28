import type { Chapter, Episode, Work } from './story.js';

export type WorkBootstrapMode = 'series' | 'one_shot';

export interface CreateWorkBootstrapInput {
  title: string;
  mode: WorkBootstrapMode;
  requestId: string;
  organizationId: string | null;
}

export interface WorkBootstrapResult {
  work: Work;
  chapter: Chapter;
  episode: Episode;
  mode: WorkBootstrapMode;
}

export interface WorkCreationMetadata {
  workId: string;
  mode: WorkBootstrapMode;
  entryChapterId: string | null;
  entryEpisodeId: string | null;
}
