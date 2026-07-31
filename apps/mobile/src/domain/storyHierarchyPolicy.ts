export const STORY_HIERARCHY_TITLE_MAX_LENGTH = 200;
export const STORY_HIERARCHY_ORDER_MAX = 1000;

export type StoryItemMoveDirection = 'up' | 'down';

export type StoryHierarchyTitleValidation =
  | { ok: true; value: string }
  | { ok: false; reason: 'required' | 'too_long' };

export type NextStoryOrderResult =
  | { ok: true; order: number }
  | { ok: false; reason: 'limit_reached' };

interface OrderedItem {
  id: string;
  order: number;
}

export interface EpisodeMoveResolution {
  allowed: boolean;
  crossChapter: boolean;
  destinationChapterId: string | null;
}

export function validateStoryHierarchyTitle(
  input: string,
): StoryHierarchyTitleValidation {
  const value = input.trim();
  if (value.length === 0) {
    return { ok: false, reason: 'required' };
  }
  if (value.length > STORY_HIERARCHY_TITLE_MAX_LENGTH) {
    return { ok: false, reason: 'too_long' };
  }
  return { ok: true, value };
}

export function nextStoryOrder(
  items: readonly Pick<OrderedItem, 'order'>[],
): NextStoryOrderResult {
  const maximum = items.reduce(
    (current, item) => Math.max(current, item.order),
    0,
  );
  if (maximum >= STORY_HIERARCHY_ORDER_MAX) {
    return { ok: false, reason: 'limit_reached' };
  }
  return { ok: true, order: maximum + 1 };
}

export function canMoveOrderedItem(
  items: readonly OrderedItem[],
  itemId: string,
  direction: StoryItemMoveDirection,
): boolean {
  const ordered = [...items].sort(compareOrderedItems);
  const itemIndex = ordered.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) {
    return false;
  }
  return direction === 'up'
    ? itemIndex > 0
    : itemIndex < ordered.length - 1;
}

export function resolveEpisodeMove(
  chapters: readonly OrderedItem[],
  chapterId: string,
  episodes: readonly OrderedItem[],
  episodeId: string,
  direction: StoryItemMoveDirection,
): EpisodeMoveResolution {
  if (canMoveOrderedItem(episodes, episodeId, direction)) {
    return {
      allowed: true,
      crossChapter: false,
      destinationChapterId: chapterId,
    };
  }

  const orderedEpisodes = [...episodes].sort(compareOrderedItems);
  const episodeIndex = orderedEpisodes.findIndex((item) => item.id === episodeId);
  if (episodeIndex < 0) {
    return unavailableEpisodeMove();
  }
  const atBoundary = direction === 'up'
    ? episodeIndex === 0
    : episodeIndex === orderedEpisodes.length - 1;
  if (!atBoundary) {
    return unavailableEpisodeMove();
  }

  const orderedChapters = [...chapters].sort(compareOrderedItems);
  const chapterIndex = orderedChapters.findIndex((item) => item.id === chapterId);
  if (chapterIndex < 0) {
    return unavailableEpisodeMove();
  }
  const destinationIndex = direction === 'up'
    ? chapterIndex - 1
    : chapterIndex + 1;
  const destinationChapter = orderedChapters[destinationIndex];
  if (destinationChapter === undefined) {
    return unavailableEpisodeMove();
  }
  return {
    allowed: true,
    crossChapter: true,
    destinationChapterId: destinationChapter.id,
  };
}

function compareOrderedItems(left: OrderedItem, right: OrderedItem): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function unavailableEpisodeMove(): EpisodeMoveResolution {
  return {
    allowed: false,
    crossChapter: false,
    destinationChapterId: null,
  };
}
