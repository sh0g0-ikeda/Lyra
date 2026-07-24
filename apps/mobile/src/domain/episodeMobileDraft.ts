import type { UpdateEpisodePayload } from '@/domain/payloads';
import type { EpisodeRecord } from '@/domain/types';

const nullableText = (value: string): string | null => {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
};

export const episodeMobileDraft = (
  episode: Pick<
    EpisodeRecord,
    | 'climax'
    | 'ending_hook'
    | 'introduction'
    | 'middle'
    | 'story_full_draft'
    | 'story_input_mode'
  >
): string => {
  if (episode.story_input_mode === 'full') {
    return episode.story_full_draft ?? '';
  }
  return [
    episode.introduction,
    episode.middle,
    episode.climax,
    episode.ending_hook
  ]
    .filter((value): value is string => value !== null && value.length > 0)
    .join('\n\n');
};

export const buildEpisodeMobileUpdatePayload = (input: {
  draft: string;
  episode: EpisodeRecord;
  estimatedPages: number;
  title: string;
}): UpdateEpisodePayload => {
  const payload: UpdateEpisodePayload = {
    expected_updated_at: input.episode.updated_at,
    estimated_pages: input.estimatedPages,
    title: nullableText(input.title)
  };
  const originalDraft = episodeMobileDraft(input.episode);
  if (
    input.episode.story_input_mode === 'full' ||
    input.draft !== originalDraft
  ) {
    payload.story_input_mode = 'full';
    payload.story_full_draft = nullableText(input.draft);
  }
  return payload;
};
