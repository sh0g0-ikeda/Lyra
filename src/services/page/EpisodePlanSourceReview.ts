import {
  EPISODE_PLAN_SOURCE_REVIEW_MAX_DISPLAY_CHARS,
  EPISODE_PLAN_SOURCE_REVIEW_MAX_UNITS,
} from '../../domain/constants/generation.js';

export interface EpisodePlanSourceReviewSource {
  scope: 'global' | 'page';
  pageId: string | null;
  sourceRef: 'global_source' | 'page_source';
  text: string;
}

export interface EpisodePlanSourceReviewUnit extends EpisodePlanSourceReviewSource {
  start: number;
  end: number;
}

export interface EpisodePlanSourceReviewCatalog {
  units: EpisodePlanSourceReviewUnit[];
}

export interface EpisodePlanSourceReviewArtifacts {
  catalog: EpisodePlanSourceReviewCatalog;
  display: string;
}

const OPEN_TO_CLOSE = new Map<string, string>([
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['‘', '’'],
]);
const CLOSERS = new Set(OPEN_TO_CLOSE.values());
const TERMINATORS = new Set(['。', '！', '？', '.', '!', '?']);

/**
 * Splits only for review bookkeeping. Every unit remains an exact, adjacent
 * slice of its typed original authority; a unit may contain several facts.
 */
export function buildEpisodePlanSourceReviewUnits(
  sources: readonly EpisodePlanSourceReviewSource[],
): EpisodePlanSourceReviewCatalog | null {
  if (sources.length === 0 || sources.every((source) => source.text.trim().length === 0)) {
    return null;
  }
  const units: EpisodePlanSourceReviewUnit[] = [];
  for (const source of sources) {
    if (source.text.length === 0) continue;
    const boundaries = findUnitBoundaries(source.text);
    let start = 0;
    for (const end of boundaries) {
      units.push({ ...source, start, end, text: source.text.slice(start, end) });
      start = end;
    }
    if (start < source.text.length) {
      units.push({ ...source, start, end: source.text.length, text: source.text.slice(start) });
    }
    if (units.length > EPISODE_PLAN_SOURCE_REVIEW_MAX_UNITS) return null;
  }
  return units.length === 0 ? null : { units };
}

export function formatEpisodePlanSourceReview(
  catalog: EpisodePlanSourceReviewCatalog,
): string | null {
  const sourceKeys: string[] = [];
  const sourceIndexByKey = new Map<string, number>();
  for (const unit of catalog.units) {
    const key = `${unit.scope}\u0000${unit.pageId ?? ''}\u0000${unit.sourceRef}`;
    if (!sourceIndexByKey.has(key)) {
      sourceIndexByKey.set(key, sourceKeys.length);
      sourceKeys.push(key);
    }
  }
  const lines = [
    '[SOURCE UNIT REVIEW - COMPLETE ORIGINAL SOURCE]',
    'Review every clause in every unit. Unit boundaries organize exact source slices; they do not imply one fact per unit.',
    ...sourceKeys.map((key, index) => {
      const [scope, pageId, sourceRef] = key.split('\u0000');
      return `s${index}|${scope}|${pageId === '' ? '-' : pageId}|${sourceRef}`;
    }),
    ...catalog.units.map((unit, index) => {
      const key = `${unit.scope}\u0000${unit.pageId ?? ''}\u0000${unit.sourceRef}`;
      return `u${index}|s${sourceIndexByKey.get(key)}|${unit.start}:${unit.end}|${JSON.stringify(unit.text)}`;
    }),
    '[END SOURCE UNIT REVIEW]',
  ];
  const display = lines.join('\n');
  return display.length <= EPISODE_PLAN_SOURCE_REVIEW_MAX_DISPLAY_CHARS ? display : null;
}

export function buildEpisodePlanSourceReviewArtifacts(
  sources: readonly EpisodePlanSourceReviewSource[],
): EpisodePlanSourceReviewArtifacts | null {
  const catalog = buildEpisodePlanSourceReviewUnits(sources);
  if (catalog === null) return null;
  const display = formatEpisodePlanSourceReview(catalog);
  return display === null ? null : { catalog, display };
}

function findUnitBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  const quoteStack: string[] = [];
  let straightDoubleQuoteOpen = false;
  let pendingQuotedTerminator = false;
  let pendingBoundary = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (pendingBoundary && !/\s/u.test(character)) {
      boundaries.push(index);
      pendingBoundary = false;
    }
    const closer = OPEN_TO_CLOSE.get(character);
    if (closer !== undefined) {
      quoteStack.push(closer);
      continue;
    }
    if (CLOSERS.has(character) && quoteStack.at(-1) === character) {
      quoteStack.pop();
      if (quoteStack.length === 0 && !straightDoubleQuoteOpen && pendingQuotedTerminator) {
        const next = text[index + 1];
        pendingBoundary = next === undefined || /\s/u.test(next);
        pendingQuotedTerminator = false;
      }
      continue;
    }
    if (character === '"') {
      straightDoubleQuoteOpen = !straightDoubleQuoteOpen;
      if (!straightDoubleQuoteOpen && quoteStack.length === 0 && pendingQuotedTerminator) {
        const next = text[index + 1];
        pendingBoundary = next === undefined || /\s/u.test(next);
        pendingQuotedTerminator = false;
      }
      continue;
    }
    if (!TERMINATORS.has(character)) continue;
    if (quoteStack.length > 0 || straightDoubleQuoteOpen) {
      pendingQuotedTerminator = true;
    } else {
      pendingBoundary = true;
    }
  }
  if (pendingBoundary) boundaries.push(text.length);
  return boundaries;
}
