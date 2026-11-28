import type { ChapterRecord, EpisodeRecord } from '../types/api.js';

export type WorkCreationMode = 'series' | 'one_shot';

export interface WorkCreationMetadata {
  work_id: string;
  mode: WorkCreationMode;
  entry_chapter_id: string | null;
  entry_episode_id: string | null;
}

export function resolveOneShotEntry(
  metadata: WorkCreationMetadata | undefined,
  chapters: readonly Pick<ChapterRecord, 'id' | 'work_id'>[],
  episodes: readonly Pick<EpisodeRecord, 'id' | 'chapter_id'>[],
): { chapterId: string; episodeId: string } | null {
  if (
    metadata?.mode !== 'one_shot'
    || metadata.entry_chapter_id === null
    || metadata.entry_episode_id === null
    || chapters.length !== 1
    || episodes.length !== 1
  ) {
    return null;
  }

  const chapter = chapters[0];
  const episode = episodes[0];
  if (
    chapter.id !== metadata.entry_chapter_id
    || chapter.work_id !== metadata.work_id
    || episode.id !== metadata.entry_episode_id
    || episode.chapter_id !== chapter.id
  ) {
    return null;
  }

  return {
    chapterId: chapter.id,
    episodeId: episode.id,
  };
}
