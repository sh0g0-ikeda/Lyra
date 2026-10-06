import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import { z } from 'zod';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  EpisodePlanAudit,
  EpisodePlanAuditGroundingAuthority,
  EpisodePlanAuditGroundingCatalog,
  EpisodePlanAuditIssueCode,
} from '../../services/page/EpisodePlanAuditCompiler.js';
import type { EpisodePlanSourceReviewCatalog, EpisodePlanSourceUnitComparison } from '../../services/page/EpisodePlanSourceReview.js';
import {
  EPISODE_PLAN_SOURCE_REVIEW_MAX_FIELDS,
  EPISODE_PLAN_SOURCE_REVIEW_MAX_EVIDENCE,
  EPISODE_PLAN_SOURCE_REVIEW_MAX_COUNTER_EVIDENCE,
} from '../../domain/constants/generation.js';

export const episodePlanSourceUnitComparisonSchema = z.object({
  verdict: z.enum(['supported', 'constraint', 'context', 'missing', 'conflict']),
  evidence: z.array(z.number().int().min(0).max(EPISODE_PLAN_SOURCE_REVIEW_MAX_FIELDS - 1)).max(EPISODE_PLAN_SOURCE_REVIEW_MAX_EVIDENCE),
  counter_evidence: z.array(z.number().int().min(0).max(EPISODE_PLAN_SOURCE_REVIEW_MAX_FIELDS - 1)).max(EPISODE_PLAN_SOURCE_REVIEW_MAX_COUNTER_EVIDENCE),
  issue: z.number().int().min(0).max(STORY_AI_LIMITS.maxSkeletonPages * 4 - 1).nullable(),
}).strict();

const REF_MAX_CHARS = 24;
const QUOTE_MAX_CHARS = 40;
const MAX_EVIDENCE_PER_ISSUE = 8;

const groundingEvidenceSchema = z.object({
  page_id: z.string().uuid(),
  source_ref: z.string().trim().min(1).max(REF_MAX_CHARS),
  quote: z.string().trim().min(4).max(QUOTE_MAX_CHARS),
}).strict();

const groundingOutputEvidenceSchema = z.object({
  page_id: z.string().uuid(),
  output_ref: z.string().trim().min(1).max(REF_MAX_CHARS),
  quote: z.string().trim().min(4).max(QUOTE_MAX_CHARS),
}).strict();

export const episodePlanAuditIssueGroundingSchema = z.object({
  issue_index: z.number().int().min(0),
  basis: z.enum(['source', 'deterministic']),
  source_evidence: z.array(groundingEvidenceSchema).max(MAX_EVIDENCE_PER_ISSUE),
  output_evidence: z.array(groundingOutputEvidenceSchema).max(MAX_EVIDENCE_PER_ISSUE),
}).strict();

export const episodePlanAuditIssueGroundingsSchema = z
  .array(episodePlanAuditIssueGroundingSchema)
  .max(240);

export type EpisodePlanAuditIssueGrounding = z.infer<typeof episodePlanAuditIssueGroundingSchema>;

export class EpisodePlanAuditGroundingError extends ConfigurationError {
  public constructor(
    message: string,
    public readonly retryInstruction: string,
  ) {
    super(message);
    this.name = 'EpisodePlanAuditGroundingError';
  }
}

const CONTEXT_AUTHORITY_CODES: ReadonlySet<EpisodePlanAuditIssueCode> = new Set([
  'timeline_discontinuity',
  'knowledge_violation',
  'page_handoff_break',
  'visible_entity_mismatch',
]);

export function validateEpisodePlanAuditIssueGrounding(input: {
  audit: EpisodePlanAudit;
  groundings: readonly EpisodePlanAuditIssueGrounding[];
  catalog: EpisodePlanAuditGroundingCatalog | undefined;
  additionalAuthorities?: readonly EpisodePlanAuditGroundingAuthority[];
}): void {
  if (input.catalog === undefined) {
    throw groundingError([], 'source-owned audit omitted its trusted grounding catalog');
  }
  const pages = uniquePages(input.catalog);
  validateRepairScope(input.audit, pages);
  const groundingByIssue = new Map<number, EpisodePlanAuditIssueGrounding>();
  for (const grounding of input.groundings) {
    if (groundingByIssue.has(grounding.issue_index)) {
      throw groundingError([grounding.issue_index], 'issue grounding contains a duplicate issue index');
    }
    groundingByIssue.set(grounding.issue_index, grounding);
  }

  const errorIndexes = input.audit.issues.flatMap((issue, issueIndex) =>
    issue.severity === 'error' ? [issueIndex] : [],
  );
  const unexpectedIndexes = [...groundingByIssue.keys()].filter((index) =>
    input.audit.issues[index]?.severity !== 'error',
  );
  if (unexpectedIndexes.length > 0) {
    throw groundingError(unexpectedIndexes, 'issue grounding may target error issues only');
  }
  const missingIndexes = errorIndexes.filter((index) => !groundingByIssue.has(index));
  if (missingIndexes.length > 0) {
    throw groundingError(missingIndexes, 'every semantic error requires typed grounding');
  }

  for (const issueIndex of errorIndexes) {
    const issue = input.audit.issues[issueIndex];
    const grounding = groundingByIssue.get(issueIndex);
    if (issue === undefined || grounding === undefined) {
      continue;
    }
    if (grounding.basis === 'deterministic') {
      const isKnownFinding = input.catalog.deterministicIssues.some((candidate) =>
        candidate.code === issue.code && sameIds(candidate.pageIds, issue.pageIds),
      );
      if (!isKnownFinding || grounding.source_evidence.length !== 0) {
        throw groundingError([issueIndex], 'deterministic grounding does not match a typed finding');
      }
      validateOutputEvidence(issueIndex, issue.pageIds, grounding.output_evidence, pages);
      continue;
    }

    const evidencePages = new Set(grounding.source_evidence.map((evidence) => evidence.page_id));
    if (!sameIds([...evidencePages], issue.pageIds)) {
      throw groundingError([issueIndex], 'source grounding must cover every affected page exactly');
    }
    for (const evidence of grounding.source_evidence) {
      const page = pages.get(evidence.page_id);
      if (page === undefined) {
        throw groundingError([issueIndex], 'source grounding referenced an unknown page');
      }
      const authority = [
        ...page.authorities,
        ...(input.additionalAuthorities ?? []),
      ].find((candidate) => candidate.ref === evidence.source_ref);
      if (authority === undefined || !authority.text.includes(evidence.quote)) {
        throw groundingError([issueIndex], 'source grounding quote is not exact in its named authority');
      }
      if (
        authority.kind !== 'original_page'
        && authority.kind !== 'original_global'
        && !CONTEXT_AUTHORITY_CODES.has(issue.code)
      ) {
        throw groundingError([issueIndex], 'context authority cannot ground this issue code');
      }
    }
    validateOutputEvidence(issueIndex, issue.pageIds, grounding.output_evidence, pages);
    if (
      issue.code !== 'source_omission'
      && issue.code !== 'ongoing_action_dropped'
      && grounding.output_evidence.length === 0
    ) {
      throw groundingError([issueIndex], 'a source contradiction requires exact output evidence');
    }
  }
}

export function validateEpisodePlanAuditSourceUnitReview(input: {
  audit: EpisodePlanAudit;
  review: readonly (number | null | EpisodePlanSourceUnitComparison)[];
  catalog: EpisodePlanSourceReviewCatalog;
  groundings: readonly EpisodePlanAuditIssueGrounding[];
  groundingCatalog: EpisodePlanAuditGroundingCatalog | undefined;
}): void {
  if (input.review.length !== input.catalog.units.length) {
    throw sourceUnitReviewError([], 'length does not match its visible catalog');
  }
  if (input.groundingCatalog === undefined) {
    throw sourceUnitReviewError([], 'trusted grounding catalog is missing');
  }
  const groundingByIssue = new Map(
    input.groundings.map((grounding) => [grounding.issue_index, grounding] as const),
  );
  for (const [unitIndex, value] of input.review.entries()) {
    const comparison = input.catalog.evidence === undefined ? null
      : episodePlanSourceUnitComparisonSchema.safeParse(value);
    if (comparison !== null && !comparison.success) {
      throw sourceUnitReviewError([], 'comparison must contain a verdict and bounded field IDs');
    }
    if (comparison === null && typeof value !== 'number' && value !== null) {
      throw sourceUnitReviewError([], 'legacy unit review must contain an issue index or null');
    }
    const issueIndex = comparison?.success === true ? comparison.data.issue
      : typeof value === 'number' ? value : null;
    const unit = input.catalog.units[unitIndex];
    if (unit === undefined) {
      throw sourceUnitReviewError([], 'visible catalog omitted a reviewed unit');
    }
    if (comparison?.success === true) {
      validateSourceUnitComparison(comparison.data, unit, input.catalog, input.groundingCatalog);
    }
    if (issueIndex !== null) {
      const issue = input.audit.issues[issueIndex];
      const grounding = groundingByIssue.get(issueIndex);
      if (issue?.severity !== 'error' || grounding?.basis !== 'source') {
        throw sourceUnitReviewError([issueIndex], 'referenced an unknown or non-source error issue');
      }
      if (unit.scope === 'page' && (unit.pageId === null || !issue.pageIds.includes(unit.pageId))) {
        throw sourceUnitReviewError([issueIndex], 'linked an issue outside the unit page');
      }
    }
    const expectedKind = unit.scope === 'page' ? 'original_page' : 'original_global';
    const unitAuthorities = input.groundingCatalog.pages.flatMap((page) => {
      if (unit.scope === 'page' && page.pageId !== unit.pageId) return [];
      return page.authorities
        .filter((authority) => authority.ref === unit.sourceRef && authority.kind === expectedKind)
        .map((authority) => ({ pageId: page.pageId, authority }));
    });
    const exactUnitAuthorities = unitAuthorities.filter(({ authority }) =>
      unit.start >= 0
      && unit.end > unit.start
      && unit.end <= authority.text.length
      && authority.text.slice(unit.start, unit.end) === unit.text,
    );
    if (exactUnitAuthorities.length === 0) {
      throw sourceUnitReviewError(issueIndex === null ? [] : [issueIndex], 'unit is not an exact span of its typed original authority');
    }
    if (issueIndex === null) continue;
    const issue = input.audit.issues[issueIndex];
    const grounding = groundingByIssue.get(issueIndex);
    if (issue === undefined || grounding === undefined) continue;
    const hasExactUnitEvidence = grounding.source_evidence.some((evidence) =>
      evidence.source_ref === unit.sourceRef
      && (unit.scope === 'global' || evidence.page_id === unit.pageId)
      && exactUnitAuthorities.some(({ pageId, authority }) =>
        pageId === evidence.page_id
        && quoteOverlapsSpan(authority.text, evidence.quote, unit.start, unit.end),
      ),
    );
    if (!hasExactUnitEvidence) {
      throw sourceUnitReviewError([issueIndex], 'issue is not grounded in that exact source unit');
    }
  }
}

function validateSourceUnitComparison(
  comparison: EpisodePlanSourceUnitComparison,
  unit: EpisodePlanSourceReviewCatalog['units'][number],
  catalog: EpisodePlanSourceReviewCatalog,
  groundingCatalog: EpisodePlanAuditGroundingCatalog,
): void {
  const errorIndexes = comparison.issue === null ? [] : [comparison.issue];
  const hasError = comparison.verdict === 'missing' || comparison.verdict === 'conflict';
  if (hasError !== (comparison.issue !== null)) {
    throw sourceUnitReviewError(errorIndexes, 'comparison verdict does not match its existing issue');
  }
  if (comparison.verdict === 'supported'
    && (comparison.evidence.length === 0 || comparison.counter_evidence.length > 0)) {
    throw sourceUnitReviewError(errorIndexes, 'supported requires positive panel evidence only');
  }
  if (comparison.verdict === 'conflict' && comparison.counter_evidence.length === 0) {
    throw sourceUnitReviewError(errorIndexes, 'conflict requires displayed counter evidence');
  }
  if (comparison.verdict === 'context'
    && (comparison.evidence.length > 0 || comparison.counter_evidence.length > 0)) {
    throw sourceUnitReviewError(errorIndexes, 'context must not claim visible story evidence');
  }
  if (comparison.verdict === 'constraint' && comparison.counter_evidence.length > 0) {
    throw sourceUnitReviewError(errorIndexes, 'contradicted constraint must link an existing error');
  }
  const ids = [...comparison.evidence, ...comparison.counter_evidence];
  if (new Set(ids).size !== ids.length) {
    throw sourceUnitReviewError(errorIndexes, 'comparison repeats a field ID');
  }
  for (const id of ids) {
    const field = catalog.evidence?.[id];
    if (field === undefined) throw sourceUnitReviewError(errorIndexes, 'unknown panel field ID');
    if (unit.scope === 'page' && field.pageId !== unit.pageId) {
      throw sourceUnitReviewError(errorIndexes, 'evidence is outside the unit page');
    }
    const page = groundingCatalog.pages.find((candidate) => candidate.pageId === field.pageId);
    const displayed = page?.outputs.some((output) => output.ref === field.ref
      && output.panelOrder === field.panelOrder && output.text === field.text);
    if (!displayed || !/^p\d+\.(?:s|b|c|x|n|e|d\d+)$/u.test(field.ref)
      || field.ref.split('.')[0] !== 'p' + field.panelOrder || field.panelOrder < 1) {
      throw sourceUnitReviewError(errorIndexes, 'evidence does not bind to a visible panel field');
    }
  }
}

function quoteOverlapsSpan(
  authorityText: string,
  quote: string,
  unitStart: number,
  unitEnd: number,
): boolean {
  let searchFrom = 0;
  while (searchFrom <= authorityText.length - quote.length) {
    const quoteStart = authorityText.indexOf(quote, searchFrom);
    if (quoteStart === -1) return false;
    const quoteEnd = quoteStart + quote.length;
    if (quoteStart < unitEnd && quoteEnd > unitStart) return true;
    searchFrom = quoteStart + 1;
  }
  return false;
}

function validateOutputEvidence(
  issueIndex: number,
  issuePageIds: readonly string[],
  evidenceValues: readonly EpisodePlanAuditIssueGrounding['output_evidence'][number][],
  pages: ReadonlyMap<string, EpisodePlanAuditGroundingCatalog['pages'][number]>,
): void {
  for (const evidence of evidenceValues) {
    if (!issuePageIds.includes(evidence.page_id)) {
      throw groundingError([issueIndex], 'output grounding is outside the issue scope');
    }
    const output = pages.get(evidence.page_id)?.outputs.find(
      (candidate) => candidate.ref === evidence.output_ref,
    );
    if (
      output === undefined
      || output.panelOrder === null
      || !output.text.includes(evidence.quote)
    ) {
      throw groundingError([issueIndex], 'output grounding quote is not exact in its named field');
    }
  }
}

function validateRepairScope(
  audit: EpisodePlanAudit,
  pages: ReadonlyMap<string, EpisodePlanAuditGroundingCatalog['pages'][number]>,
): void {
  const errorPageIds = new Set(
    audit.issues
      .filter((issue) => issue.severity === 'error')
      .flatMap((issue) => issue.pageIds),
  );
  const repairedFields = new Set<string>();
  for (const repair of audit.pageRepairs ?? []) {
    if (!pages.has(repair.pageId)) {
      throw groundingError([], 'page repair is outside the audit scope');
    }
    if (!errorPageIds.has(repair.pageId)) {
      throw groundingError([], 'repair targeted a page without an error');
    }
    for (const field of repair.changedFields) {
      assertUniqueRepairField(repairedFields, `page:${repair.pageId}:${field}`);
    }
  }
  for (const repair of audit.panelRepairs ?? []) {
    const page = pages.get(repair.pageId);
    const knownPanel = page?.outputs.some((output) => output.panelOrder === repair.panelOrder) ?? false;
    if (!knownPanel) {
      throw groundingError([], 'panel repair is outside the audit scope');
    }
    if (!errorPageIds.has(repair.pageId)) {
      throw groundingError([], 'repair targeted a page without an error');
    }
    for (const field of repair.changedFields) {
      assertUniqueRepairField(
        repairedFields,
        `panel:${repair.pageId}:${repair.panelOrder}:${field}`,
      );
    }
  }
}

function assertUniqueRepairField(repairedFields: Set<string>, key: string): void {
  if (repairedFields.has(key)) {
    throw groundingError([], 'repair changed the same field more than once');
  }
  repairedFields.add(key);
}

function uniquePages(
  catalog: EpisodePlanAuditGroundingCatalog,
): Map<string, EpisodePlanAuditGroundingCatalog['pages'][number]> {
  const pages = new Map<string, EpisodePlanAuditGroundingCatalog['pages'][number]>();
  for (const page of catalog.pages) {
    if (pages.has(page.pageId)) {
      throw groundingError([], 'grounding catalog contains a duplicate page');
    }
    pages.set(page.pageId, page);
  }
  return pages;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function groundingError(issueIndexes: readonly number[], detail: string): EpisodePlanAuditGroundingError {
  const boundedIndexes = [...new Set(issueIndexes)].slice(0, 8);
  return new EpisodePlanAuditGroundingError(
    `Episode plan audit issue grounding is invalid: ${detail}`,
    [
      `Grounding correction for the retry: issue_errors=${issueIndexes.length || 1};`,
      `issue_indexes=${JSON.stringify(boundedIndexes)}.`,
      'Rebuild the full audit. Ground each source-dependent error in exact named original or typed visible authority text and exact draft fields. Compiled purpose, continuity, panel notes, and entity metadata are never original-source authority.',
    ].join(' '),
  );
}

function sourceUnitReviewError(
  issueIndexes: readonly number[],
  detail: string,
): EpisodePlanAuditGroundingError {
  const boundedIndexes = [...new Set(issueIndexes)].slice(0, 8);
  return new EpisodePlanAuditGroundingError(
    `Episode plan audit source unit review is invalid: ${detail}`,
    [
      `Source unit review correction for the retry: issue_indexes=${JSON.stringify(boundedIndexes)}.`,
      'Rebuild the full audit and review every displayed uN in order using the requested contract. For PANEL FIELD EVIDENCE, return a verdict, positive/counter field IDs, and an existing grounded source-error issue for each missing/conflicting unit. Otherwise return the legacy index/null. Do not change unit scope, page, ref, span, or source text.',
    ].join(' '),
  );
}
