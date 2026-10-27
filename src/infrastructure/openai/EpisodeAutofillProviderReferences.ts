import { ConfigurationError } from '../../domain/errors/index.js';
import type { EpisodeAutofillCharacterReference } from '../../services/page/EpisodePagePlanCompiler.js';

const INVALID_VISIBLE_ENTITY_REFERENCE = 'invalid_provider_entity_reference';
const PROVIDER_REF_JSON_SCHEMA_PATTERN = '^[A-Z][A-Z0-9_-]{0,31}$';
const PROVIDER_REF_PATTERN = new RegExp(PROVIDER_REF_JSON_SCHEMA_PATTERN, 'u');
// Structured Outputs permits at most 1,000 enum values across one schema.
// Keep headroom for every pre-existing enum while the server allowlist remains authoritative.
const PROVIDER_ENTITY_REFERENCE_ENUM_LIMIT = 128;

export interface EpisodeAutofillProviderReferenceMode {
  readonly references: readonly EpisodeAutofillCharacterReference[];
  readonly refs: readonly string[];
  readonly fallbackRef: string | null;
  readonly fallbackEntityId: string | null;
  readonly entityIdByRef: ReadonlyMap<string, string>;
  readonly allowedEntityIds: ReadonlySet<string>;
}

export function createEpisodeAutofillProviderReferenceMode(
  references: readonly EpisodeAutofillCharacterReference[] | undefined,
): EpisodeAutofillProviderReferenceMode | null {
  if (references === undefined) {
    return null;
  }

  const stableReferences = [...references];
  const entityIdByRef = new Map<string, string>();
  const allowedEntityIds = new Set<string>();
  for (const reference of stableReferences) {
    if (!PROVIDER_REF_PATTERN.test(reference.ref)) {
      throw new ConfigurationError('Episode autofill provider reference is invalid');
    }
    if (entityIdByRef.has(reference.ref) || allowedEntityIds.has(reference.entityId)) {
      throw new ConfigurationError('Episode autofill provider references must be unique');
    }
    entityIdByRef.set(reference.ref, reference.entityId);
    allowedEntityIds.add(reference.entityId);
  }
  const fallbackReference = stableReferences.find((reference) =>
    reference.entityType === 'character' || reference.entityType === 'nonhuman')
    ?? stableReferences[0];

  return {
    references: stableReferences,
    refs: stableReferences.map((reference) => reference.ref),
    fallbackRef: fallbackReference?.ref ?? null,
    fallbackEntityId: fallbackReference?.entityId ?? null,
    entityIdByRef,
    allowedEntityIds,
  };
}

export function providerDialogueEntityIdJsonSchema(
  mode: EpisodeAutofillProviderReferenceMode,
): Record<string, unknown> {
  if (mode.refs.length === 0) {
    return { type: 'null' };
  }
  return {
    anyOf: [
      providerEntityReferenceStringJsonSchema(mode),
      { type: 'null' },
    ],
  };
}

export function providerVisibleEntityIdJsonSchema(
  mode: EpisodeAutofillProviderReferenceMode,
): Record<string, unknown> {
  return mode.refs.length === 0
    ? { type: 'string' }
    : providerEntityReferenceStringJsonSchema(mode);
}

function providerEntityReferenceStringJsonSchema(
  mode: EpisodeAutofillProviderReferenceMode,
): Record<string, unknown> {
  if (mode.refs.length <= PROVIDER_ENTITY_REFERENCE_ENUM_LIMIT) {
    return { type: 'string', enum: [...mode.refs] };
  }
  return {
    type: 'string',
    pattern: PROVIDER_REF_JSON_SCHEMA_PATTERN,
    maxLength: 32,
  };
}

export function rewriteEpisodeAutofillProviderBrief(
  compilerBrief: string,
  mode: EpisodeAutofillProviderReferenceMode,
): string {
  const catalog = mode.references.length === 0
    ? '(no registered entities are available; keep visible entities empty and use null only for narration)'
    : mode.references.map((reference) =>
        `${reference.ref} | entity_id=${reference.entityId} | type=${reference.entityType} | name=${JSON.stringify(reference.name)}`,
      ).join('\n');
  return [
    compilerBrief,
    '',
    '[SERVER ENTITY REFERENCE CATALOG]',
    catalog,
    '[END SERVER ENTITY REFERENCE CATALOG]',
  ].join('\n');
}

export function episodeAutofillProviderReferenceInstruction(
  mode: EpisodeAutofillProviderReferenceMode,
): string {
  if (mode.refs.length === 0) {
    return 'No entity references are available. Return entities=[] in every panel. Use entity_id=null only for narration; do not invent an entity identifier.';
  }
  return `For dialogue entity_id and visible entities[].entity_id, output only a ref from SERVER ENTITY REFERENCE CATALOG. The server resolves refs to authorized entity IDs. Never output a UUID, name, or unlisted ref. Narration must use entity_id=null. Unknown or ambiguous non-narration speakers must use fallback ref ${mode.fallbackRef} so the bounded plan remains editable. Do not add a visible entity merely because that entity speaks off-panel.`;
}

export function sanitizeEpisodePagePlanProviderReferences(
  value: unknown,
  mode: EpisodeAutofillProviderReferenceMode,
): unknown {
  if (!isRecord(value) || !Array.isArray(value.pages)) {
    return value;
  }
  return {
    ...value,
    pages: value.pages.map((page) => {
      if (!isRecord(page) || !Array.isArray(page.panels)) {
        return page;
      }
      return { ...page, panels: page.panels.map((panel) => sanitizePanel(panel, mode)) };
    }),
  };
}

export function sanitizeEpisodePlanAuditProviderReferences(
  value: unknown,
  mode: EpisodeAutofillProviderReferenceMode,
): unknown {
  if (!isRecord(value) || !Array.isArray(value.panel_repairs)) {
    return value;
  }
  return {
    ...value,
    panel_repairs: value.panel_repairs.map((repair) => {
      if (!isRecord(repair) || !isRecord(repair.patch)) {
        return repair;
      }
      return { ...repair, patch: sanitizePanel(repair.patch, mode) };
    }),
  };
}

function sanitizePanel(
  value: unknown,
  mode: EpisodeAutofillProviderReferenceMode,
): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    ...(Array.isArray(value.dialogue)
      ? { dialogue: value.dialogue.map((line) => sanitizeDialogueLine(line, mode)) }
      : {}),
    ...(Array.isArray(value.entities)
      ? { entities: value.entities.map((entity) => sanitizeVisibleEntity(entity, mode)) }
      : {}),
  };
}

function sanitizeDialogueLine(
  value: unknown,
  mode: EpisodeAutofillProviderReferenceMode,
): unknown {
  if (!isRecord(value)) {
    return value;
  }
  if (value.type === 'narration') {
    return { ...value, entity_id: null };
  }
  if (!requiresSpeaker(value.type)) {
    return value;
  }
  return {
    ...value,
    entity_id: resolveProviderEntityId(value.entity_id, mode) ?? mode.fallbackEntityId,
  };
}

function sanitizeVisibleEntity(
  value: unknown,
  mode: EpisodeAutofillProviderReferenceMode,
): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    entity_id: resolveProviderEntityId(value.entity_id, mode) ?? INVALID_VISIBLE_ENTITY_REFERENCE,
  };
}

function resolveProviderEntityId(
  value: unknown,
  mode: EpisodeAutofillProviderReferenceMode,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const mapped = mode.entityIdByRef.get(value);
  if (mapped !== undefined) {
    return mapped;
  }
  return mode.allowedEntityIds.has(value) ? value : null;
}

function requiresSpeaker(value: unknown): boolean {
  return value === 'speech' || value === 'thought' || value === 'shout' || value === 'whisper';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
