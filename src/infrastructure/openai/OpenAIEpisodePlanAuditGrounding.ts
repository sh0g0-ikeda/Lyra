import { z } from 'zod';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  EpisodePlanAudit,
  EpisodePlanAuditGroundingAuthority,
  EpisodePlanAuditGroundingCatalog,
  EpisodePlanAuditIssueCode,
} from '../../services/page/EpisodePlanAuditCompiler.js';

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
