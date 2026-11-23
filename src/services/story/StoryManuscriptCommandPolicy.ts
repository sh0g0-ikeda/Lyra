import { hasStoryManuscriptCommands } from '../../../packages/api-contract/src/storyManuscript.js';

export interface StoryManuscriptCommandPolicy {
  interpretCommands: boolean;
  includeSavedSidecarNotes: boolean;
}

/** Versioned callers may express intent in the manuscript itself. The saved
 * toggle still exclusively owns legacy sidecar notes; inline commands never
 * revive sidecar data that the user disabled. */
export function resolveStoryManuscriptCommandPolicy(input: {
  versioned: boolean;
  savedEnabled: boolean;
  source: string;
}): StoryManuscriptCommandPolicy {
  const interpretCommands = input.versioned
    && (input.savedEnabled || hasStoryManuscriptCommands(input.source));
  return {
    interpretCommands,
    includeSavedSidecarNotes: input.versioned && input.savedEnabled,
  };
}

export function episodeStoryManuscriptSource(input: {
  storyFullDraft?: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
}): string {
  return input.storyFullDraft ?? [input.introduction, input.middle, input.climax, input.endingHook]
    .filter((part): part is string => part !== null)
    .join('\n\n');
}
