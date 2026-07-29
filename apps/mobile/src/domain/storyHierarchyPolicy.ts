import type { CreateChapterPayload, CreateEpisodePayload } from '@/domain/payloads';

interface OrderedRecord {
  order: number;
}

interface EpisodeMovePosition {
  chapterIndex: number;
  chapterCount: number;
  episodeIndex: number;
  episodeCount: number;
  direction: 'up' | 'down';
}

export function nextStoryOrder(records: readonly OrderedRecord[]): number {
  return records.reduce((maximum, record) => Math.max(maximum, record.order), 0) + 1;
}

export function buildNewChapterPayload(
  title: string,
  chapters: readonly OrderedRecord[]
): CreateChapterPayload {
  return {
    order: nextStoryOrder(chapters),
    title: title.trim(),
    purpose: null,
    starting_state: null,
    ending_state: null,
    emotion_curve: null,
    entities_involved: [],
    key_beats: []
  };
}

export function buildNewEpisodePayload(
  title: string,
  episodes: readonly OrderedRecord[]
): CreateEpisodePayload {
  return {
    order: nextStoryOrder(episodes),
    title: title.trim(),
    purpose: null,
    story_input_mode: 'full',
    story_full_draft: null,
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
    estimated_pages: 4,
    entities_involved: []
  };
}

export function canMoveEpisodeInHierarchy(position: EpisodeMovePosition): boolean {
  if (position.episodeCount <= 0 || position.chapterCount <= 0) {
    return false;
  }
  if (position.direction === 'up') {
    return position.episodeIndex > 0 || position.chapterIndex > 0;
  }
  return (
    position.episodeIndex < position.episodeCount - 1 ||
    position.chapterIndex < position.chapterCount - 1
  );
}
