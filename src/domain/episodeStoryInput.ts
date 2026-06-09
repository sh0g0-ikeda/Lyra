export type EpisodeStoryInputMode = 'structured' | 'full';

export interface EpisodeStoryInputSnapshot {
  storyInputMode: EpisodeStoryInputMode;
  purpose: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
  storyFullDraft: string | null;
}

export interface NormalizedEpisodeStoryInput extends EpisodeStoryInputSnapshot {
  normalizedIntroduction: string | null;
  normalizedMiddle: string | null;
  normalizedClimax: string | null;
  normalizedEndingHook: string | null;
}

export function normalizeEpisodeStoryInput(input: EpisodeStoryInputSnapshot): NormalizedEpisodeStoryInput {
  if (input.storyInputMode === 'full') {
    const normalizedFullDraft = normalizeNullableText(input.storyFullDraft);
    const derived = deriveStructuredStorySections(normalizedFullDraft);

    return {
      storyInputMode: 'full',
      purpose: normalizeNullableText(input.purpose),
      introduction: null,
      middle: null,
      climax: null,
      endingHook: null,
      storyFullDraft: normalizedFullDraft,
      normalizedIntroduction: derived.introduction,
      normalizedMiddle: derived.middle,
      normalizedClimax: derived.climax,
      normalizedEndingHook: derived.endingHook,
    };
  }

  return {
    storyInputMode: 'structured',
    purpose: normalizeNullableText(input.purpose),
    introduction: normalizeNullableText(input.introduction),
    middle: normalizeNullableText(input.middle),
    climax: normalizeNullableText(input.climax),
    endingHook: normalizeNullableText(input.endingHook),
    storyFullDraft: null,
    normalizedIntroduction: normalizeNullableText(input.introduction),
    normalizedMiddle: normalizeNullableText(input.middle),
    normalizedClimax: normalizeNullableText(input.climax),
    normalizedEndingHook: normalizeNullableText(input.endingHook),
  };
}

export function hasStructuredStoryBodyContent(input: {
  introduction: string | null | undefined;
  middle: string | null | undefined;
  climax: string | null | undefined;
  endingHook: string | null | undefined;
}): boolean {
  return (
    normalizeNullableText(input.introduction ?? null) !== null ||
    normalizeNullableText(input.middle ?? null) !== null ||
    normalizeNullableText(input.climax ?? null) !== null ||
    normalizeNullableText(input.endingHook ?? null) !== null
  );
}

export function hasFullStoryDraftContent(value: string | null | undefined): boolean {
  return normalizeNullableText(value ?? null) !== null;
}

export function hasConflictingEpisodeStoryInput(input: EpisodeStoryInputSnapshot): boolean {
  return hasFullStoryDraftContent(input.storyFullDraft) && hasStructuredStoryBodyContent(input);
}

export function buildFullStoryDraftFromStructuredSections(input: {
  introduction: string | null | undefined;
  middle: string | null | undefined;
  climax: string | null | undefined;
  endingHook: string | null | undefined;
}): string | null {
  const parts = [
    normalizeNullableText(input.introduction ?? null),
    normalizeNullableText(input.middle ?? null),
    normalizeNullableText(input.climax ?? null),
    normalizeNullableText(input.endingHook ?? null),
  ].filter((value): value is string => value !== null);

  if (parts.length === 0) {
    return null;
  }

  return parts.join('\n\n');
}

export function deriveStructuredStorySections(fullStoryDraft: string | null): {
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  endingHook: string | null;
} {
  if (fullStoryDraft === null) {
    return {
      introduction: null,
      middle: null,
      climax: null,
      endingHook: null,
    };
  }

  const segments = splitStorySegments(fullStoryDraft);
  if (segments.length === 0) {
    return {
      introduction: null,
      middle: null,
      climax: null,
      endingHook: null,
    };
  }

  const bucketCount = Math.min(4, segments.length);
  const buckets = Array.from({ length: bucketCount }, () => [] as string[]);

  for (let index = 0; index < segments.length; index += 1) {
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((index * bucketCount) / segments.length));
    buckets[bucketIndex]?.push(segments[index] ?? '');
  }

  const [introduction, middle, climax, endingHook] = Array.from({ length: 4 }, (_value, index) => {
    const bucket = buckets[index];
    if (bucket === undefined || bucket.length === 0) {
      return null;
    }

    return bucket.join('\n\n');
  });

  return {
    introduction,
    middle,
    climax,
    endingHook,
  };
}

function splitStorySegments(fullStoryDraft: string): string[] {
  const normalized = fullStoryDraft
    .replace(/\r\n/g, '\n')
    .replace(/\u3000/g, ' ')
    .trim();
  if (normalized.length === 0) {
    return [];
  }

  const paragraphSegments = normalized
    .split(/\n{2,}/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (paragraphSegments.length >= 2) {
    return paragraphSegments;
  }

  const sentences = splitIntoSentences(normalized);
  if (sentences.length > 0) {
    return sentences;
  }

  return [normalized];
}

function splitIntoSentences(value: string): string[] {
  const sentences: string[] = [];
  let current = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    current += character;
    if (isSentenceBoundary(character, value[index + 1] ?? '')) {
      const normalized = current.trim();
      if (normalized.length > 0) {
        sentences.push(normalized);
      }
      current = '';
    }
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    sentences.push(trailing);
  }

  return sentences;
}

function isSentenceBoundary(current: string, next: string): boolean {
  if (
    current === '\u3002' ||
    current === '\uff01' ||
    current === '\uff1f' ||
    current === '!' ||
    current === '?'
  ) {
    return true;
  }

  if (current !== '.') {
    return false;
  }

  return next === '' || next === ' ' || next === '\n';
}

function normalizeNullableText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}
