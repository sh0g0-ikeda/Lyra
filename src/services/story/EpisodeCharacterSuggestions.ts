import type { EpisodeCharacterSuggestion, ExtractedCharacter } from '../../../packages/api-contract/src/characterSuggestions.js';
import type { Episode } from '../../domain/types/story.js';
import type { StoryEntitySummary } from '../../domain/types/storyAi.js';

export function episodeCharacterSource(episode: Episode, _productionNotesEnabled: boolean): string[] {
  const body = episode.storyInputMode === 'full' ? [episode.storyFullDraft] :
    [episode.introduction, episode.middle, episode.climax, episode.endingHook];
  return body.flatMap((field) => {
    if (field === null) return [];
    const prose = field.trim();
    return prose.length === 0 ? [] : [prose];
  });
}

export function groundCharacterSuggestions(
  source: readonly string[],
  roster: readonly StoryEntitySummary[],
  extracted: readonly ExtractedCharacter[],
): EpisodeCharacterSuggestion[] {
  const seen = new Set<string>();
  const containsQuote = (value: string): boolean => source.some((part) => part.includes(value));
  const candidateNames = [...roster.flatMap((entry) => [entry.name, ...entry.aliases]), ...extracted.map((entry) => entry.name)];

  return extracted.flatMap((character): EpisodeCharacterSuggestion[] => {
    if (!containsQuote(character.name_quote) || !mentionsName(character.name_quote, character.name)) return [];
    const nameKey = normalizeName(character.name);
    const matches = roster.filter((entity) =>
      [entity.name, ...entity.aliases].some((alias) => normalizeName(alias) === nameKey));
    // A named object is insufficient evidence for a new cast member.
    if (matches.some((entity) => entity.entityType === 'object')) return [];
    const match = matches.length === 1 ? matches[0] : undefined;
    const key = match?.id ?? nameKey;
    if (seen.has(key)) return [];
    seen.add(key);

    const otherNames = candidateNames.filter((name) => normalizeName(name) !== nameKey &&
      !matches.some((entity) => [entity.name, ...entity.aliases].some((alias) => normalizeName(alias) === normalizeName(name))));
    const supported = (evidence: string, value: string): boolean =>
      containsQuote(evidence) && mentionsName(evidence, character.name) && evidence.includes(value)
      && !/(?:もし|ならば|だったら|ではない|じゃない|かもしれ|\b(?:if|might|not)\b)/iu.test(evidence)
      && !otherNames.some((name) => mentionsName(evidence, name));
    const usedTraits = new Set<string>();
    const appearance = matches.length > 0 ? [] : character.appearance.filter((trait) => {
      const key = JSON.stringify([trait.field, trait.value]);
      if (usedTraits.has(key) || !supported(trait.quote, trait.value)) return false;
      usedTraits.add(key);
      return true;
    });

    return [{
      name: character.name,
      name_quote: character.name_quote,
      entity_type: match?.entityType === 'nonhuman' ? 'nonhuman' :
        match?.entityType === 'character' ? 'character' : character.entity_type,
      status: matches.length > 1 ? 'ambiguous' : matches.length === 1 ? 'existing' : 'new',
      entity_ids: matches.map((entity) => entity.id),
      appearance,
      changes: character.changes.filter((change) => supported(change.quote, change.description)),
    }];
  });
}

function normalizeName(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase();
}

function mentionsName(quoteText: string, characterName: string): boolean {
  const normalizedName = normalizeName(characterName);
  const escaped = normalizedName.replace(/[.*+?^$${}()|[\]\\]/gu, '\\$&');
  return /^[a-z\d .'-]+$/u.test(normalizedName)
    ? new RegExp(`(?<![a-z\\d])${escaped}(?![a-z\\d])`, 'u').test(normalizeName(quoteText))
    : normalizeName(quoteText).includes(normalizedName);
}
