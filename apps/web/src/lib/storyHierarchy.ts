export type StoryMoveDirection = 'up' | 'down';

export interface OrderedStoryItem {
  id: string;
  order: number;
}

export interface EpisodeMoveResolution {
  allowed: boolean;
  crossesChapter: boolean;
  destinationChapterId: string | null;
}

export function sortStoryItems<T extends OrderedStoryItem>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function getAppendOrder(items: readonly Pick<OrderedStoryItem, 'order'>[]): number {
  return items.reduce((maximum, item) => Math.max(maximum, item.order), 0) + 1;
}

export function parseExpandedNodeIds(rawValue: string): string[] {
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return Array.from(
      new Set(parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
    );
  } catch {
    return [];
  }
}

export function resolveEpisodeMove(
  chapters: readonly OrderedStoryItem[],
  currentChapterId: string,
  episodeIndex: number,
  episodeCount: number,
  direction: StoryMoveDirection,
): EpisodeMoveResolution {
  if (episodeIndex < 0 || episodeIndex >= episodeCount || episodeCount < 1) {
    return { allowed: false, crossesChapter: false, destinationChapterId: null };
  }

  const hasSameChapterDestination = direction === 'up' ? episodeIndex > 0 : episodeIndex < episodeCount - 1;
  if (hasSameChapterDestination) {
    return { allowed: true, crossesChapter: false, destinationChapterId: currentChapterId };
  }

  const orderedChapters = sortStoryItems(chapters);
  const chapterIndex = orderedChapters.findIndex((chapter) => chapter.id === currentChapterId);
  const destinationIndex = direction === 'up' ? chapterIndex - 1 : chapterIndex + 1;
  const destinationChapter = chapterIndex < 0 ? undefined : orderedChapters[destinationIndex];

  if (destinationChapter === undefined) {
    return { allowed: false, crossesChapter: false, destinationChapterId: null };
  }

  return {
    allowed: true,
    crossesChapter: true,
    destinationChapterId: destinationChapter.id,
  };
}
