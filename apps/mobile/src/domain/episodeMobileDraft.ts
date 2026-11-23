import { startingStateSavePatch, type EpisodeStartingState } from '@/domain/episodeStartingStates';
import type { UpdateEpisodePayload } from '@/domain/payloads';
import type { EpisodeRecord } from '@/domain/types';

const nullableText = (value: string): string | null => {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
};

const quoted = '「[^」\\r\\n]{1,160}」';
const pairNote = new RegExp(`^${quoted}と${quoted}は(?:同じコマ|別(?:の)?コマ)(?:にする)?[。.]?$`, 'u');
const stateStartNote = new RegExp(`^${quoted}のコマから${quoted}は${quoted}(?:状態)?[。.]?$`, 'u');
const stateEndNote = new RegExp(`^${quoted}のコマ(?:で|から)${quoted}は通常に戻(?:す|る)[。.]?$`, 'u');

export function separateProductionNoteLines(
  draft: string,
  enabled: boolean,
  preservedNotes: readonly string[] = [],
): { body: string; notes: string[] } {
  const body: string[] = [];
  const notes: string[] = [];
  const preserved = new Set(preservedNotes);
  for (const line of draft.split(/\r?\n/u)) {
    const match = /^[ \t]*[#＃][ \t]*(\S.*)$/u.exec(line);
    const note = match?.[1]?.trimEnd();
    if (note !== undefined && ((enabled && (pairNote.test(note) || stateStartNote.test(note) || stateEndNote.test(note)))
      || (!enabled && preserved.has(note)))) notes.push(note);
    else body.push(line);
  }
  return { body: body.join('\n'), notes: [...new Set(notes)] };
}

export const episodeMobileDraft = (
  episode: Pick<
    EpisodeRecord,
    | 'climax'
    | 'ending_hook'
    | 'introduction'
    | 'middle'
    | 'story_full_draft'
    | 'story_input_mode'
    | 'production_notes'
    | 'production_notes_enabled'
  >
): string => {
  const prose = episode.story_input_mode === 'full' ? episode.story_full_draft ?? '' : [
    episode.introduction,
    episode.middle,
    episode.climax,
    episode.ending_hook
  ]
    .filter((value): value is string => value !== null && value.length > 0)
    .join('\n\n');
  const noteLines = (episode.production_notes ?? []).map((note) => `# ${note}`);
  return [prose, ...noteLines].filter((part) => part.length > 0).join('\n');
};

export const buildEpisodeMobileUpdatePayload = (input: {
  draft: string;
  episode: EpisodeRecord;
  estimatedPages: number;
  title: string;
  startingEntityStates?: EpisodeStartingState[];
}): UpdateEpisodePayload => {
  const payload: UpdateEpisodePayload = {
    ...startingStateSavePatch(input.startingEntityStates),
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
