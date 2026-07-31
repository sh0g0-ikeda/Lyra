export interface EpisodeStoryDraft {
  title: string;
  story: string;
  estimatedPages: string;
  sourceStoryInputMode: 'structured' | 'full';
}

export interface EpisodeStoryUpdatePayload {
  title: string | null;
  estimated_pages: number;
  story_input_mode?: 'full';
  story_full_draft?: string | null;
}

export type EpisodeStoryValidationReason =
  | 'title_too_long'
  | 'story_too_long'
  | 'estimated_pages_out_of_range';

export type EpisodeStoryUpdateResult =
  | { ok: true; payload: EpisodeStoryUpdatePayload }
  | {
      ok: false;
      reason: EpisodeStoryValidationReason;
    };

const MAX_TITLE_LENGTH = 200;
const MAX_STORY_LENGTH = 8_000;
const MIN_ESTIMATED_PAGES = 1;
const MAX_ESTIMATED_PAGES = 32;

interface NormalizedEpisodeStoryDraft {
  title: string | null;
  story: string | null;
  estimatedPages: number;
}

export function createEpisodeStoryDraft(input: {
  title: string | null;
  story_input_mode: 'structured' | 'full';
  story_full_draft: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  ending_hook: string | null;
  estimated_pages: number;
}): EpisodeStoryDraft {
  const story = input.story_input_mode === 'full'
    ? input.story_full_draft ?? ''
    : [input.introduction, input.middle, input.climax, input.ending_hook]
        .map((section) => section?.trim() ?? '')
        .filter((section) => section.length > 0)
        .join('\n\n');

  return {
    title: input.title ?? '',
    story,
    estimatedPages: String(input.estimated_pages),
    sourceStoryInputMode: input.story_input_mode,
  };
}

export function buildEpisodeStoryUpdate(
  savedDraft: EpisodeStoryDraft,
  currentDraft: EpisodeStoryDraft,
): EpisodeStoryUpdateResult {
  const normalized = normalizeEpisodeStoryDraft(currentDraft);
  if (!normalized.ok) {
    return normalized;
  }

  const payload: EpisodeStoryUpdatePayload = {
    title: normalized.value.title,
    estimated_pages: normalized.value.estimatedPages,
  };
  if (savedDraft.story.trim() !== currentDraft.story.trim()) {
    payload.story_input_mode = 'full';
    payload.story_full_draft = normalized.value.story;
  }

  return { ok: true, payload };
}

export function isEpisodeStoryDraftDirty(
  savedDraft: EpisodeStoryDraft,
  currentDraft: EpisodeStoryDraft,
): boolean {
  const saved = normalizeEpisodeStoryDraft(savedDraft);
  const current = normalizeEpisodeStoryDraft(currentDraft);
  if (!saved.ok || !current.ok) {
    return true;
  }
  return (
    saved.value.title !== current.value.title
    || saved.value.story !== current.value.story
    || saved.value.estimatedPages !== current.value.estimatedPages
  );
}

function normalizeEpisodeStoryDraft(
  draft: EpisodeStoryDraft,
):
  | { ok: true; value: NormalizedEpisodeStoryDraft }
  | { ok: false; reason: EpisodeStoryValidationReason } {
  const title = draft.title.trim();
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, reason: 'title_too_long' };
  }

  const story = draft.story.trim();
  if (story.length > MAX_STORY_LENGTH) {
    return { ok: false, reason: 'story_too_long' };
  }

  const normalizedPages = draft.estimatedPages.trim();
  if (!/^[0-9]+$/u.test(normalizedPages)) {
    return { ok: false, reason: 'estimated_pages_out_of_range' };
  }
  const estimatedPages = Number(normalizedPages);
  if (
    !Number.isSafeInteger(estimatedPages)
    || estimatedPages < MIN_ESTIMATED_PAGES
    || estimatedPages > MAX_ESTIMATED_PAGES
  ) {
    return { ok: false, reason: 'estimated_pages_out_of_range' };
  }

  return {
    ok: true,
    value: {
      title: title.length === 0 ? null : title,
      story: story.length === 0 ? null : story,
      estimatedPages,
    },
  };
}
