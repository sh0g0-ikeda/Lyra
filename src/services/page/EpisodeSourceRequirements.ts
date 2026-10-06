import { Buffer } from 'node:buffer';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { EpisodeBeatPlan } from './EpisodeBeatPlanCompiler.js';

const PAGE_SOURCE_HEADER_PATTERN = /^(?:Page[ \t]+(\d+)|(\d+)[ \t]*ページ目)[ \t]*[:：]/gmu;
const MAX_SOURCE_UNITS = 256;
const MAX_REQUIREMENTS = 512;
// Bound the compact parsed JSON below the 32k output setting using one UTF-8 byte
// per token and 8k nominal headroom. This does not prove provider whitespace or
// reasoning margin; oversized/unsupported source takes the pre-paid legacy path.
const MAX_REQUIREMENT_PROVIDER_OUTPUT_BYTES = 24_000;
const MAX_REQUIREMENT_SERIALIZED_BYTES = 64_000;
const MAX_SOURCE_DISPLAY_CHARS = 8_000;
// One record per nonblank lossless sentence unit. Each record carries up to five ordered
// obligations, so page frame counts never cap source extraction.
// The per-record coefficient is combined with 1024 + 128 * pageCount reserve.
// A maximal compact record is 413 bytes (414 with its separator); every pack
// accepted below 24k has at most 56 records, so the reserve covers that difference.
// This is a bound for compact JSON, not provider whitespace or reasoning tokens.
const REQUIREMENT_PROVIDER_WORST_CASE_BYTES = 408;

export interface EpisodeSourceRequirementPageRef {
  pageId: string;
  pageNumber: number;
}

export interface EpisodeSourceUnit {
  unitId: string;
  scope: 'global' | 'page';
  pageId: string | null;
  pageNumber: number | null;
  text: string;
}

export interface EpisodeSourceRequirementExtraction {
  pages: EpisodeSourceRequirementPageRef[];
  units: EpisodeSourceUnit[];
  compilerBrief: string;
  estimatedWorstCaseOutputBytes: number;
}

export interface EpisodeSourceRequirement {
  requirementId: string;
  scope: 'global' | 'page';
  pageId: string | null;
  pageNumber: number | null;
  sourceUnitIds: string[];
  order: number;
  events: string[];
  results: string[];
  afterRequirementIds: string[];
  conditionalUntil: string | null;
  requiredByEnd: boolean;
  context: string | null;
  emotion: string | null;
  function: string | null;
  camera: string | null;
  framing: string | null;
  quotedText: string[];
  obligations?: Array<{
    event: string;
    result: string | null;
    conditionalUntil: string | null;
    requiredByEnd: boolean;
  }>;
}

export interface EpisodeSourceRequirements {
  requirements: EpisodeSourceRequirement[];
}

/**
 * Preflight is intentionally independent of draft plans. A null result means
 * the caller must retain the entire legacy beat-ledger path before any paid call.
 */
export function prepareEpisodeSourceRequirementExtraction(input: {
  storyFullDraft: string;
  pages: readonly EpisodeSourceRequirementPageRef[];
}): EpisodeSourceRequirementExtraction | null {
  const pages = [...input.pages].sort((left, right) => left.pageNumber - right.pageNumber);
  if (pages.length === 0 || input.storyFullDraft.length === 0 ||
      input.storyFullDraft.length > MAX_SOURCE_DISPLAY_CHARS) {
    return null;
  }
  const uniquePageIds = new Set(pages.map((page) => page.pageId));
  const uniquePageNumbers = new Set(pages.map((page) => page.pageNumber));
  if (uniquePageIds.size !== pages.length || uniquePageNumbers.size !== pages.length) {
    return null;
  }

  PAGE_SOURCE_HEADER_PATTERN.lastIndex = 0;
  const matches = Array.from(input.storyFullDraft.matchAll(PAGE_SOURCE_HEADER_PATTERN));
  if (matches.length !== pages.length) {
    return null;
  }
  const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page] as const));
  const observedPageNumbers: number[] = [];
  for (const match of matches) {
    const pageNumber = Number(match[1] ?? match[2]);
    if (!Number.isSafeInteger(pageNumber) || !pageByNumber.has(pageNumber)) {
      return null;
    }
    observedPageNumbers.push(pageNumber);
  }
  if (observedPageNumbers.some((pageNumber, index) =>
    index > 0 && pageNumber <= (observedPageNumbers[index - 1] ?? 0))) {
    return null;
  }

  const units: EpisodeSourceUnit[] = [];
  const firstStart = matches[0]?.index ?? 0;
  if (firstStart > 0) {
    units.push(...splitLosslessSourceUnits(
      input.storyFullDraft.slice(0, firstStart),
      'global',
      null,
      null,
    ));
  }
  matches.forEach((match, index) => {
    const pageNumber = observedPageNumbers[index]!;
    const page = pageByNumber.get(pageNumber)!;
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? input.storyFullDraft.length;
    units.push(...splitLosslessSourceUnits(
      input.storyFullDraft.slice(start, end),
      'page',
      page.pageId,
      page.pageNumber,
    ));
  });
  if (units.length === 0 || units.length > MAX_SOURCE_UNITS ||
      units.map((unit) => unit.text).join('') !== input.storyFullDraft ||
      units.some((unit) => countExplicitQuotedSegments(unit.text) > 4 ||
        countPotentialOrderedSpans(unit.text) > 5)) {
    return null;
  }

  const estimatedWorstCaseOutputBytes = estimateRequirementOutputBytes(
    pages.length,
    units.filter((unit) => unit.text.trim().length > 0).length,
  );
  const compilerBrief = formatExtractionBrief(pages, units);
  return { pages, units, compilerBrief, estimatedWorstCaseOutputBytes };
}

export function buildEpisodeSourceRequirementExtractionPacks(
  extraction: EpisodeSourceRequirementExtraction,
  pagePacks: readonly (readonly EpisodeSourceRequirementPageRef[])[],
): EpisodeSourceRequirementExtraction[] | null {
  const packDrafts = pagePacks.map((pages) => {
    const pageIds = new Set(pages.map((page) => page.pageId));
    const units = extraction.units.filter((unit) =>
      unit.pageId !== null && pageIds.has(unit.pageId),
    );
    return { pages: [...pages], units };
  });
  const globalUnits = extraction.units.filter((unit) => unit.pageId === null);
  for (const globalUnit of globalUnits) {
    const draft = globalUnit.text.trim().length === 0
      ? packDrafts[0]
      : [...packDrafts]
          .sort((left, right) => remainingRequirementCapacity(right) - remainingRequirementCapacity(left))[0];
    const owner = draft?.pages[0];
    if (draft === undefined || owner === undefined ||
        (globalUnit.text.trim().length > 0 && remainingRequirementCapacity(draft) < 1)) {
      return null;
    }
    draft.units.push({ ...globalUnit, pageId: owner.pageId, pageNumber: owner.pageNumber });
  }
  const packed = packDrafts.map(({ pages, units }) => {
    units.sort((left, right) => sourceUnitOrdinal(extraction, left.unitId) - sourceUnitOrdinal(extraction, right.unitId));
    const estimatedWorstCaseOutputBytes = estimateRequirementOutputBytes(
      pages.length,
      units.filter((unit) => unit.text.trim().length > 0).length,
    );
    return {
      pages,
      units,
      compilerBrief: formatExtractionBrief(pages, units),
      estimatedWorstCaseOutputBytes,
    };
  });
  const seenUnitIds = new Set(packed.flatMap((pack) => pack.units.map((unit) => unit.unitId)));
  if (packed.length !== pagePacks.length || seenUnitIds.size !== extraction.units.length ||
      packed.some((pack) => pack.units.length === 0 ||
        pack.estimatedWorstCaseOutputBytes > MAX_REQUIREMENT_PROVIDER_OUTPUT_BYTES)) {
    return null;
  }
  return packed;
}

function remainingRequirementCapacity(draft: {
  pages: readonly EpisodeSourceRequirementPageRef[];
  units: readonly EpisodeSourceUnit[];
}): number {
  const fixedBytes = 1_024 + draft.pages.length * 128;
  const used = draft.units.filter((unit) => unit.text.trim().length > 0).length;
  return Math.floor((MAX_REQUIREMENT_PROVIDER_OUTPUT_BYTES - fixedBytes) /
    REQUIREMENT_PROVIDER_WORST_CASE_BYTES) - used;
}

function sourceUnitOrdinal(extraction: EpisodeSourceRequirementExtraction, unitId: string): number {
  return extraction.units.findIndex((unit) => unit.unitId === unitId);
}

export function validateEpisodeSourceRequirements(
  extraction: EpisodeSourceRequirementExtraction,
  value: EpisodeSourceRequirements,
): EpisodeSourceRequirements {
  if (value.requirements.length === 0 || value.requirements.length > MAX_REQUIREMENTS) {
    throw new ConfigurationError('Source requirements exceeded the bounded contract');
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_REQUIREMENT_SERIALIZED_BYTES) {
    throw new ConfigurationError('Source requirements exceeded the structured output budget');
  }
  const pagesById = new Map(extraction.pages.map((page) => [page.pageId, page] as const));
  const unitsById = new Map(extraction.units.map((unit) => [unit.unitId, unit] as const));
  const requirementsById = new Map<string, EpisodeSourceRequirement>();
  const seenOrdersByPage = new Map<string, Set<number>>();
  const coveredUnitIds = new Set<string>();

  for (const requirement of value.requirements) {
    if (!/^[A-Za-z0-9_-]{1,24}$/u.test(requirement.requirementId) ||
        requirementsById.has(requirement.requirementId)) {
      throw new ConfigurationError('Source requirement IDs must be unique');
    }
    const page = requirement.pageId === null ? undefined : pagesById.get(requirement.pageId);
    if ((requirement.scope === 'global' && (requirement.pageId !== null || requirement.pageNumber !== null)) ||
        (requirement.scope === 'page' && (page === undefined || page.pageNumber !== requirement.pageNumber))) {
      throw new ConfigurationError('Source requirement referenced an unknown page owner');
    }
    if (requirement.scope === 'global' && (requirement.events.length > 0 || requirement.results.length > 0 ||
        requirement.conditionalUntil !== null || requirement.requiredByEnd || requirement.obligations !== undefined)) {
      throw new ConfigurationError('Global source requirements must remain non-placement context');
    }
    if (!Number.isSafeInteger(requirement.order) || requirement.order < 1 || requirement.order > 10_000) {
      throw new ConfigurationError('Source requirement order must be a positive integer');
    }
    const orderOwner = requirement.scope === 'global' ? 'global' : requirement.pageId!;
    const seenOrders = seenOrdersByPage.get(orderOwner) ?? new Set<number>();
    if (seenOrders.has(requirement.order)) {
      throw new ConfigurationError('Source requirement order must be unique within a page');
    }
    seenOrders.add(requirement.order);
    seenOrdersByPage.set(orderOwner, seenOrders);
    if (requirement.sourceUnitIds.length !== 1 ||
        (requirement.scope === 'page' && requirement.events.length < 1) ||
        requirement.events.length > 5 || requirement.results.length > 5 ||
        requirement.afterRequirementIds.length > 4 || requirement.quotedText.length > 4) {
      throw new ConfigurationError('Source requirement exceeded its bounded fields');
    }
    const ownedSource: string[] = [];
    for (const unitId of requirement.sourceUnitIds) {
      const unit = unitsById.get(unitId);
      if (unit === undefined || unit.text.trim().length === 0 || unit.scope !== requirement.scope ||
          (requirement.scope === 'page' && unit.pageId !== requirement.pageId)) {
        throw new ConfigurationError('Source requirement cited an unknown or differently owned unit');
      }
      if (coveredUnitIds.has(unitId)) {
        throw new ConfigurationError('Original source units must have one requirement record');
      }
      coveredUnitIds.add(unitId);
      ownedSource.push(unit.text);
    }
    const ownedSourceText = ownedSource.join('');
    // The source-owned flow is already isolated by continuity V3. Requiring the
    // literal global unit here proves complete transport, not semantic quality.
    if (requirement.scope === 'global' && requirement.context !== ownedSourceText.trim()) {
      throw new ConfigurationError(
        'Global source requirement context must preserve the complete trimmed source unit',
      );
    }
    assertRequirementTextIsSourceOwned(requirement, ownedSourceText);
    if (requirement.obligations !== undefined) {
      if (requirement.obligations.length === 0 || requirement.obligations.length > 5 ||
          requirement.obligations.map((obligation) => obligation.event).join('\u0000') !== requirement.events.join('\u0000') ||
          requirement.obligations.flatMap((obligation) => obligation.result === null ? [] : [obligation.result])
            .join('\u0000') !== requirement.results.join('\u0000') ||
          (requirement.obligations.find((obligation) => obligation.conditionalUntil !== null)
            ?.conditionalUntil ?? null) !== requirement.conditionalUntil ||
          requirement.obligations.some((obligation) => obligation.requiredByEnd) !== requirement.requiredByEnd) {
        throw new ConfigurationError('Source requirement obligations must preserve ordered events');
      }
    }
    requirementsById.set(requirement.requirementId, requirement);
  }

  for (const unit of extraction.units) {
    if (unit.text.trim().length > 0 && !coveredUnitIds.has(unit.unitId)) {
      throw new ConfigurationError('Source requirements did not cover every original source unit');
    }
  }
  for (const requirement of value.requirements) {
    if (new Set(requirement.afterRequirementIds).size !== requirement.afterRequirementIds.length) {
      throw new ConfigurationError('Source requirement order must not repeat relations');
    }
    for (const predecessorId of requirement.afterRequirementIds) {
      if (!requirementsById.has(predecessorId) || predecessorId === requirement.requirementId) {
        throw new ConfigurationError('Source requirement order referenced an unknown requirement');
      }
    }
  }
  assertAcyclicRequirementRelations(value.requirements, requirementsById);
  return value;
}

export function formatEpisodeSourceRequirementsForDetail(
  requirements: EpisodeSourceRequirements,
  currentPageIds: ReadonlySet<string>,
): string {
  const global = requirements.requirements
    .filter((requirement) => requirement.scope === 'global')
    .sort((left, right) => left.order - right.order);
  const current = requirements.requirements
    .filter((requirement) => requirement.scope === 'page' &&
      requirement.pageId !== null && currentPageIds.has(requirement.pageId))
    .sort((left, right) => (left.pageNumber ?? 0) - (right.pageNumber ?? 0) || left.order - right.order);
  return [
    '[SOURCE REQUIREMENTS - ORIGINAL ONLY]',
    '[GLOBAL SOURCE CONTEXT/STYLE/CONSTRAINTS]',
    ...global.map((requirement) => JSON.stringify(requirement)),
    '[PAGE SOURCE REQUIREMENTS REQUIRING PANEL PLACEMENT]',
    ...current.map((requirement) => JSON.stringify(requirement)),
    '[END SOURCE REQUIREMENTS]',
    'Global requirements are context/style/constraints for every current page and do not require panel placement or a visible event.',
    'Before drafting editable fields, assign every listed PAGE requirement to one or more panel orders in source_requirement_placements. Preserve prerequisite relations, conditions, and required_by_end completion. The placement is internal structure and is not source evidence or proof of semantic fidelity.',
  ].join('\n');
}

export function filterEpisodeSourceRequirementsByPageIds(
  requirements: EpisodeSourceRequirements,
  pageIds: ReadonlySet<string>,
): EpisodeSourceRequirements {
  return {
    requirements: requirements.requirements.filter((requirement) =>
      requirement.scope === 'global' ||
      (requirement.pageId !== null && pageIds.has(requirement.pageId))),
  };
}

export function buildAuditCompatibilityPlanFromSourceRequirements(
  pages: readonly EpisodeSourceRequirementPageRef[],
  requirements: EpisodeSourceRequirements,
): EpisodeBeatPlan {
  return {
    pages: [...pages]
      .sort((left, right) => left.pageNumber - right.pageNumber)
      .map((page) => ({
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        storyBeats: requirements.requirements
          .filter((requirement) => requirement.scope === 'page' && requirement.pageId === page.pageId)
          .sort((left, right) => left.order - right.order)
          .map((requirement) => `${requirement.requirementId}: ${requirement.events.join(' / ')}`),
        entryState: 'original source authority',
        exitState: 'original source authority',
        newInformation: [],
        dialogueIntent: null,
        handoff: null,
      })),
  };
}

function splitLosslessSourceUnits(
  text: string,
  scope: EpisodeSourceUnit['scope'],
  pageId: string | null,
  pageNumber: number | null,
): EpisodeSourceUnit[] {
  const chunks = text.match(/[^。！？!?\r\n]*(?:[。！？!?]+|\r?\n|$)/gu)?.filter((chunk) => chunk.length > 0) ?? [text];
  return chunks.map((chunk, index) => ({
    unitId: scope === 'global' ? `global-u${index + 1}` : `p${pageNumber}-u${index + 1}`,
    scope,
    pageId,
    pageNumber,
    text: chunk,
  }));
}

function estimateRequirementOutputBytes(pageCount: number, nonblankUnitCount: number): number {
  const requirementCount = Math.min(MAX_REQUIREMENTS, nonblankUnitCount);
  return 1_024 +
    pageCount * 128 +
    requirementCount * REQUIREMENT_PROVIDER_WORST_CASE_BYTES;
}

function countExplicitQuotedSegments(text: string): number {
  return (text.match(/「/gu) ?? []).length +
    (text.match(/“/gu) ?? []).length +
    Math.floor((text.match(/"/gu) ?? []).length / 2);
}

function countPotentialOrderedSpans(text: string): number {
  if (text.trim().length === 0) return 0;
  return 1 + (text.match(/[、,，;；]/gu) ?? []).length;
}

function assertRequirementTextIsSourceOwned(
  requirement: EpisodeSourceRequirement,
  source: string,
): void {
  const values = [
    ...requirement.events,
    ...requirement.results,
    requirement.conditionalUntil,
    requirement.context,
    requirement.emotion,
    requirement.function,
    requirement.camera,
    requirement.framing,
    ...requirement.quotedText,
    ...(requirement.obligations ?? []).flatMap((obligation) => [
      obligation.event,
      obligation.result,
      obligation.conditionalUntil,
    ]),
  ].filter((value): value is string => value !== null);
  if (values.some((value) => value.length === 0 || !source.includes(value))) {
    throw new ConfigurationError('Source requirement text must be an exact original-source span');
  }
}

function formatExtractionBrief(
  pages: readonly EpisodeSourceRequirementPageRef[],
  units: readonly EpisodeSourceUnit[],
): string {
  return [
    '[PURPOSE]',
    'Extract lossless original-source requirements before any editable page draft is generated.',
    '[ALLOWED PAGE OWNERS]',
    ...pages.map((page) => `Page ${page.pageNumber} (${page.pageId})`),
    '[ORIGINAL SOURCE UNITS - ONLY AUTHORITY]',
    ...units.map((unit, index) => `${index + 1} | unit_id=${unit.unitId} | scope=${unit.scope} | page_id=${unit.scope === 'global' ? 'global' : unit.pageId} | ${JSON.stringify(unit.text)}`),
    '[END ORIGINAL SOURCE UNITS]',
  ].join('\n');
}

function assertAcyclicRequirementRelations(
  requirements: readonly EpisodeSourceRequirement[],
  requirementsById: ReadonlyMap<string, EpisodeSourceRequirement>,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (requirementId: string): void => {
    if (visited.has(requirementId)) return;
    if (visiting.has(requirementId)) {
      throw new ConfigurationError('Source requirement order contains a cycle');
    }
    visiting.add(requirementId);
    for (const predecessorId of requirementsById.get(requirementId)?.afterRequirementIds ?? []) {
      visit(predecessorId);
    }
    visiting.delete(requirementId);
    visited.add(requirementId);
  };
  requirements.forEach((requirement) => visit(requirement.requirementId));
}

export const EPISODE_SOURCE_REQUIREMENT_LIMITS = {
  maxUnits: MAX_SOURCE_UNITS,
  maxRequirements: MAX_REQUIREMENTS,
  maxProviderOutputBytes: MAX_REQUIREMENT_PROVIDER_OUTPUT_BYTES,
  maxProviderBytesPerRequirement: REQUIREMENT_PROVIDER_WORST_CASE_BYTES,
  maxSerializedBytes: MAX_REQUIREMENT_SERIALIZED_BYTES,
} as const;
