export interface CanonicalEntityReference {
  id: string;
  name: string;
  aliases?: string[];
}

interface CanonicalAliasVariant {
  entityId: string;
  canonicalName: string;
  variant: string;
  normalizedVariant: string;
}

const GENERIC_ENTITY_LABELS = new Set([
  '影',
  '光',
  '声',
  '人影',
  '少女',
  '少年',
  '女子高生',
  '男子高校生',
  '生徒',
  '隊員',
  '班員',
  '兵士',
  '青年',
  '老人',
]);

const GENERIC_ENTITY_SUFFIX_PATTERN = /(高校生|中学生|小学生|生徒|隊員|班員|兵士|少年|少女|青年|老人)$/u;

export function extractEntityAliases(structuredFields: Record<string, unknown>): string[] {
  const aliasesValue =
    readAliasArray(structuredFields.aliases) ??
    readAliasArray(readRecord(structuredFields.character_identity)?.aliases);
  if (aliasesValue === null) {
    return [];
  }

  return Array.from(
    new Set(
      aliasesValue
        .flatMap((entry) => (typeof entry === 'string' ? [entry.trim()] : []))
        .filter((entry) => entry.length > 0),
    ),
  );
}

export function canonicalizeEntityMentionsInText<T extends CanonicalEntityReference>(
  value: string | null | undefined,
  entities: T[],
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  let nextValue = value;
  for (const variant of buildCanonicalAliasVariants(entities)) {
    if (variant.variant === variant.canonicalName) {
      continue;
    }

    nextValue = replaceExactMentions(nextValue, variant.variant, variant.canonicalName);
  }

  return nextValue;
}

export function canonicalizeEntityMentionsInTexts<T extends CanonicalEntityReference>(
  values: Array<string | null | undefined>,
  entities: T[],
): string[] {
  return values.flatMap((value) => {
    const normalized = canonicalizeEntityMentionsInText(value, entities);
    return normalized === null ? [] : [normalized];
  });
}

export function inferEntityIdsFromTexts<T extends CanonicalEntityReference>(
  entities: T[],
  texts: Array<string | null | undefined>,
  limit: number,
  preferredEntityIds: string[] = [],
): string[] {
  const canonicalTexts = canonicalizeEntityMentionsInTexts(texts, entities).join('\n');
  if (canonicalTexts.trim().length === 0) {
    return [];
  }

  const scored = entities.map((entity) => {
    let score = preferredEntityIds.includes(entity.id) ? 10 : 0;
    const isLooseInferenceAllowed =
      preferredEntityIds.includes(entity.id) || canInferEntityFromLooseText(entity);
    const matches = isLooseInferenceAllowed ? countSubstringOccurrences(canonicalTexts, entity.name) : 0;
    score += matches * 100;
    return { entityId: entity.id, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.entityId);
}

export function findMentionedCanonicalEntityIds<T extends CanonicalEntityReference>(
  entities: T[],
  texts: Array<string | null | undefined>,
): string[] {
  return inferEntityIdsFromTexts(entities, texts, entities.length);
}

function buildCanonicalAliasVariants<T extends CanonicalEntityReference>(
  entities: T[],
): CanonicalAliasVariant[] {
  const uniqueVariantMap = new Map<string, CanonicalAliasVariant | null>();

  for (const entity of entities) {
    const rawVariants = [entity.name, ...(entity.aliases ?? [])]
      .map((variant) => variant.trim())
      .filter((variant) => variant.length > 0);
    for (const variant of Array.from(new Set(rawVariants))) {
      const normalizedVariant = normalizeAliasVariant(variant);
      if (normalizedVariant.length === 0) {
        continue;
      }

      const existing = uniqueVariantMap.get(normalizedVariant);
      const nextVariant: CanonicalAliasVariant = {
        entityId: entity.id,
        canonicalName: entity.name,
        variant,
        normalizedVariant,
      };

      if (existing === undefined) {
        uniqueVariantMap.set(normalizedVariant, nextVariant);
        continue;
      }

      if (existing !== null && existing.entityId !== entity.id) {
        uniqueVariantMap.set(normalizedVariant, null);
      }
    }
  }

  return Array.from(uniqueVariantMap.values())
    .flatMap((entry) => (entry === null ? [] : [entry]))
    .sort((left, right) => right.variant.length - left.variant.length);
}

function replaceExactMentions(value: string, variant: string, canonicalName: string): string {
  if (variant.length === 0 || value.includes(variant) === false) {
    return value;
  }

  return value.split(variant).join(canonicalName);
}

function countSubstringOccurrences(value: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let cursor = 0;
  while (cursor <= value.length - needle.length) {
    const index = value.indexOf(needle, cursor);
    if (index === -1) {
      break;
    }
    count += 1;
    cursor = index + needle.length;
  }

  return count;
}

function normalizeAliasVariant(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function canInferEntityFromLooseText(entity: CanonicalEntityReference): boolean {
  if (!looksLikeGenericEntityLabel(entity.name)) {
    return true;
  }

  return (entity.aliases ?? []).some((alias) => alias.trim().length > 0 && !looksLikeGenericEntityLabel(alias));
}

function looksLikeGenericEntityLabel(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return true;
  }

  return GENERIC_ENTITY_LABELS.has(normalized) || GENERIC_ENTITY_SUFFIX_PATTERN.test(normalized);
}

function readAliasArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
