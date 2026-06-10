import { canonicalizeEntityMentionsInText } from './entityAliases.js';
import type { StoryEntitySummary } from './types/storyAi.js';

export const STORY_PROMPT_CONTEXT_LIMITS = {
  generalFieldChars: 900,
  payloadFieldChars: 1000,
  entityDescriptionChars: 220,
  aliasChars: 48,
  maxAliasesPerEntity: 6,
  maxEntities: 20,
  summaryItemChars: 220,
  maxSceneSummaries: 40,
  maxChapterSummaries: 12,
  maxSiblingEpisodeSummaries: 16,
} as const;

export function compactStoryPromptText(
  value: string | number | boolean | null | undefined,
  maxLength: number = STORY_PROMPT_CONTEXT_LIMITS.generalFieldChars,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

export function compactCanonicalStoryPromptText(
  value: string | null | undefined,
  entities: readonly StoryEntitySummary[],
  maxLength: number = STORY_PROMPT_CONTEXT_LIMITS.generalFieldChars,
): string | null {
  return compactStoryPromptText(canonicalizeEntityMentionsInText(value ?? null, Array.from(entities)), maxLength);
}

export function formatStoryPromptParts(
  values: ReadonlyArray<string | null | undefined>,
  entities: readonly StoryEntitySummary[],
  maxLength = STORY_PROMPT_CONTEXT_LIMITS.generalFieldChars,
): string {
  const parts = values
    .map((value) => compactCanonicalStoryPromptText(value, entities, maxLength))
    .filter((value): value is string => value !== null);

  return parts.length === 0 ? '(none)' : parts.join(' / ');
}

export function formatStoryPromptEntityList(
  entities: readonly StoryEntitySummary[],
  maxEntities = STORY_PROMPT_CONTEXT_LIMITS.maxEntities,
): string {
  const visibleEntities = entities.slice(0, maxEntities).map(formatStoryPromptEntity);
  if (entities.length > maxEntities) {
    visibleEntities.push(`... (${entities.length - maxEntities} more)`);
  }

  return visibleEntities.length === 0 ? '(none)' : visibleEntities.join(' / ');
}

export function formatStoryPromptSummaryList(
  items: readonly string[],
  entities: readonly StoryEntitySummary[],
  options: {
    maxItems: number;
    maxItemLength?: number;
  },
): string {
  const maxItemLength = options.maxItemLength ?? STORY_PROMPT_CONTEXT_LIMITS.summaryItemChars;
  const visibleItems = items
    .slice(0, options.maxItems)
    .map((item) => compactCanonicalStoryPromptText(item, entities, maxItemLength))
    .filter((value): value is string => value !== null);

  if (items.length > options.maxItems) {
    visibleItems.push(`... (${items.length - options.maxItems} more)`);
  }

  return visibleItems.length === 0 ? '(none)' : visibleItems.join(' / ');
}

function formatStoryPromptEntity(entity: StoryEntitySummary): string {
  const description = compactStoryPromptText(
    entity.freeDescription,
    STORY_PROMPT_CONTEXT_LIMITS.entityDescriptionChars,
  );
  const aliases = entity.aliases
    .slice(0, STORY_PROMPT_CONTEXT_LIMITS.maxAliasesPerEntity)
    .map((alias) => compactStoryPromptText(alias, STORY_PROMPT_CONTEXT_LIMITS.aliasChars))
    .filter((alias): alias is string => alias !== null);

  const details = [
    entity.entityType,
    description,
    aliases.length === 0 ? null : `aliases: ${aliases.join(', ')}`,
  ].filter((value): value is string => value !== null);

  return `${entity.name} (${details.join(', ')})`;
}
