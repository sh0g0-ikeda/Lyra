import { ConfigurationError } from '../../domain/errors/index.js';
import type { EpisodeAutofillStateReference } from '../../services/page/EpisodeAutofillStateReferences.js';
import { StructuredOpenAIResponseError } from './StructuredOpenAIResponse.js';
import type { EpisodeAutofillProviderReferenceMode } from './EpisodeAutofillProviderReferences.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface ProviderStateReference {
  readonly providerEntityId: string;
  readonly entityId: string;
  readonly stateId: string;
  readonly name: string | null;
  readonly description: string | null;
}

export interface EpisodeAutofillProviderStateReferenceMode {
  readonly references: readonly ProviderStateReference[];
  readonly stateIds: readonly string[];
  readonly allowedPairKeys: ReadonlySet<string>;
}

export class EpisodeAutofillProviderStateReferenceError extends StructuredOpenAIResponseError {
  public readonly correction = [
    '[STATE REFERENCE CORRECTION - SERVER DATA]',
    'A returned entity assignment omitted state_id or used a state that did not belong to its decoded entity_id in the authorized state catalog.',
    'Use only an exact entity/state pair from SERVER STATE REFERENCE CATALOG, or use JSON null for the default state.',
    '[END STATE REFERENCE CORRECTION]',
  ].join('\n');

  public constructor() {
    super(
      'Episode autofill returned an unauthorized entity/state pair',
      'invalid_payload',
      true,
      null,
    );
  }
}

export function assertExplicitEpisodePagePlanProviderStateIds(
  value: unknown,
  mode: EpisodeAutofillProviderStateReferenceMode | null,
): void {
  if (mode === null || !isRecord(value) || !Array.isArray(value.pages)) return;
  for (const page of value.pages) {
    if (!isRecord(page) || !Array.isArray(page.panels)) continue;
    for (const panel of page.panels) {
      if (!isRecord(panel) || !Array.isArray(panel.entities)) continue;
      assertEntityAssignmentsHaveStateId(panel.entities);
    }
  }
}

export function assertExplicitEpisodePlanAuditProviderStateIds(
  value: unknown,
  mode: EpisodeAutofillProviderStateReferenceMode | null,
): void {
  if (mode === null || !isRecord(value) || !Array.isArray(value.panel_repairs)) return;
  for (const repair of value.panel_repairs) {
    if (!isRecord(repair) || !isRecord(repair.patch) || !Array.isArray(repair.patch.entities)) continue;
    assertEntityAssignmentsHaveStateId(repair.patch.entities);
  }
}

function assertEntityAssignmentsHaveStateId(values: readonly unknown[]): void {
  if (values.some((value) => isRecord(value) && !Object.hasOwn(value, 'state_id'))) {
    throw new EpisodeAutofillProviderStateReferenceError();
  }
}

/**
 * Converts trusted UUID pairs into the provider's entity namespace. Validation
 * later runs after provider aliases have been decoded, so schema and persistence
 * authorization share the same server-owned catalog.
 */
export function createEpisodeAutofillProviderStateReferenceMode(
  references: readonly EpisodeAutofillStateReference[] | undefined,
  entityMode: EpisodeAutofillProviderReferenceMode | null,
): EpisodeAutofillProviderStateReferenceMode | null {
  if (references === undefined) return null;

  const providerRefByEntityId = entityMode === null
    ? null
    : new Map(entityMode.references.map((reference) => [reference.entityId, reference.ref] as const));
  const stableReferences: ProviderStateReference[] = [];
  const pairKeys = new Set<string>();
  for (const reference of references) {
    if (!UUID_PATTERN.test(reference.entityId) || !UUID_PATTERN.test(reference.stateId)) {
      throw new ConfigurationError('Episode autofill state reference is invalid');
    }
    const pairKey = `${reference.entityId}:${reference.stateId}`;
    if (pairKeys.has(pairKey)) continue;
    const providerEntityId = providerRefByEntityId?.get(reference.entityId) ?? reference.entityId;
    if (entityMode !== null && !providerRefByEntityId?.has(reference.entityId)) {
      throw new ConfigurationError('Episode autofill state reference entity is unavailable');
    }
    pairKeys.add(pairKey);
    stableReferences.push({ ...reference, providerEntityId });
  }

  return {
    references: stableReferences,
    stateIds: [...new Set(stableReferences.map((reference) => reference.stateId))],
    allowedPairKeys: pairKeys,
  };
}

export function providerStateIdJsonSchema(
  mode: EpisodeAutofillProviderStateReferenceMode | null,
): Record<string, unknown> {
  if (mode === null) {
    return { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] };
  }
  if (mode.stateIds.length === 0) return { type: 'null' };
  return {
    anyOf: [
      { type: 'string', enum: [...mode.stateIds] },
      { type: 'null' },
    ],
  };
}

export function rewriteEpisodeAutofillProviderStateBrief(
  compilerBrief: string,
  mode: EpisodeAutofillProviderStateReferenceMode | null,
): string {
  if (mode === null) return compilerBrief;
  const catalog = mode.references.length === 0
    ? '(no registered states are available; use JSON null only)'
    : mode.references.map((reference) =>
        `${reference.providerEntityId} | state_id=${reference.stateId}` +
        ` | name=${JSON.stringify(normalizeCatalogText(reference.name, 100))}` +
        ` | description=${JSON.stringify(normalizeCatalogText(reference.description, 300))}`,
      ).join('\n');
  return [
    compilerBrief,
    '',
    '[SERVER STATE REFERENCE CATALOG]',
    catalog,
    '[END SERVER STATE REFERENCE CATALOG]',
  ].join('\n');
}

function normalizeCatalogText(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) return null;
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function episodeAutofillProviderStateInstruction(
  mode: EpisodeAutofillProviderStateReferenceMode | null,
): string | null {
  if (mode === null) return null;
  const visualFallbackInstruction = 'state_id=null means no registered state image reference. Preserve source-grounded or validated visual-fallback changes in editable effect_note, situation, composition, or panel notes; do not erase them and do not invent a new change.';
  if (mode.references.length === 0) {
    return `No authorized state references are available. Return state_id=null for every visible entity. ${visualFallbackInstruction}`;
  }
  return `For state_id, use only the state paired with that entity in SERVER STATE REFERENCE CATALOG, or JSON null for the default state. Never move a state to another entity. ${visualFallbackInstruction}`;
}

export function assertAuthorizedEpisodeAutofillProviderStateReferences(
  assignments: readonly { readonly entityId: string; readonly stateId: string | null }[],
  mode: EpisodeAutofillProviderStateReferenceMode | null,
): void {
  if (mode === null) return;
  const invalid = assignments.some((assignment) => assignment.stateId !== null &&
    !mode.allowedPairKeys.has(`${assignment.entityId}:${assignment.stateId}`));
  if (invalid) throw new EpisodeAutofillProviderStateReferenceError();
}
