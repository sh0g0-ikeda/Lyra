import { ConfigurationError } from '../../domain/errors/index.js';
import {
  EPISODE_PLAN_AUDIT_COVERAGE_MAX_CHECKS_PER_PAGE,
  EPISODE_PLAN_AUDIT_COVERAGE_MAX_EVIDENCE_PER_CHECK,
  EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS,
  EPISODE_PLAN_AUDIT_COVERAGE_REF_MAX_CHARS,
} from '../../lib/validators/episodePlanAudit.schema.js';
import type { EpisodePlanAudit } from './EpisodePlanAuditCompiler.js';

export {
  EPISODE_PLAN_AUDIT_COVERAGE_MAX_CHECKS_PER_PAGE,
  EPISODE_PLAN_AUDIT_COVERAGE_MAX_EVIDENCE_PER_CHECK,
  EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS,
  EPISODE_PLAN_AUDIT_COVERAGE_REF_MAX_CHARS,
};

export interface EpisodePlanAuditCoverageCatalogSource {
  ref: string;
  text: string;
}

export interface EpisodePlanAuditCoverageCatalogOutput {
  ref: string;
  text: string;
  panelOrder: number | null;
}

export interface EpisodePlanAuditCoverageCatalogPage {
  pageId: string;
  sources: EpisodePlanAuditCoverageCatalogSource[];
  outputs: EpisodePlanAuditCoverageCatalogOutput[];
}

export interface EpisodePlanAuditCoverageCatalog {
  pages: EpisodePlanAuditCoverageCatalogPage[];
}

const MAX_CITATION_DIAGNOSTICS = 8;
const MAX_CITATION_RETRY_CHARS = 4_000;

interface CitationDiagnostic {
  pageId: string;
  checkIndex: number;
  evidenceIndex: number | null;
  kind: 'source' | 'output';
  ref: string;
  refKnown: boolean;
  reason: 'unknown_ref' | 'not_exact';
  validRefs?: string[];
}

export class EpisodePlanAuditCoverageError extends ConfigurationError {
  public constructor(
    message: string,
    public readonly retryInstruction: string,
  ) {
    super(message);
    this.name = 'EpisodePlanAuditCoverageError';
  }
}

/**
 * Verifies that provider citations exist in the exact source/output fields and
 * that every reported omission is wired to an existing same-page repair.
 * Exact substring checks prove provenance only; semantic correctness remains
 * the audit model's responsibility and the bounded second audit's concern.
 */
export function validateEpisodePlanAuditCoverage(
  audit: EpisodePlanAudit,
  catalog: EpisodePlanAuditCoverageCatalog,
): void {
  const coverage = audit.sourceCoverage;
  if (coverage === undefined) {
    throw new ConfigurationError('Episode plan audit omitted source coverage');
  }

  const catalogByPage = uniqueByPage(catalog.pages, 'catalog');
  const coverageByPage = uniqueByPage(coverage, 'coverage');
  const citationDiagnostics: CitationDiagnostic[] = [];
  let citationErrorCount = 0;
  const recordCitationDiagnostic = (diagnostic: CitationDiagnostic): void => {
    citationErrorCount += 1;
    if (citationDiagnostics.length < MAX_CITATION_DIAGNOSTICS) {
      citationDiagnostics.push(diagnostic);
    }
  };
  if (
    catalogByPage.size !== coverageByPage.size
    || [...catalogByPage.keys()].some((pageId) => !coverageByPage.has(pageId))
  ) {
    throw new ConfigurationError('Episode plan audit coverage must include every page exactly once');
  }

  for (const [pageId, pageCoverage] of coverageByPage) {
    const pageCatalog = catalogByPage.get(pageId);
    if (pageCatalog === undefined) {
      throw new ConfigurationError('Episode plan audit coverage referenced an unknown page');
    }
    const sourceByRef = uniqueByRef(pageCatalog.sources, pageId, 'source');
    const outputByRef = uniqueByRef(pageCatalog.outputs, pageId, 'output');
    const seenChecks = new Set<string>();

    for (const [checkIndex, check] of pageCoverage.checks.entries()) {
      const checkKey = `${check.sourceRef}\u0000${check.sourceQuote}`;
      if (seenChecks.has(checkKey)) {
        throw new ConfigurationError('Episode plan audit coverage contains a duplicate check');
      }
      seenChecks.add(checkKey);

      const source = sourceByRef.get(check.sourceRef);
      if (source === undefined) {
        recordCitationDiagnostic({
          pageId,
          checkIndex,
          evidenceIndex: null,
          kind: 'source',
          ref: 'unknown',
          refKnown: false,
          reason: 'unknown_ref',
          validRefs: [...sourceByRef.keys()],
        });
      } else if (!source.text.includes(check.sourceQuote)) {
        recordCitationDiagnostic({
          pageId,
          checkIndex,
          evidenceIndex: null,
          kind: 'source',
          ref: check.sourceRef,
          refKnown: true,
          reason: 'not_exact',
        });
      }

      const evidenceCitations = new Set<string>();
      for (const [evidenceIndex, evidence] of check.outputEvidence.entries()) {
        const evidenceKey = `${evidence.outputRef}\u0000${evidence.quote}`;
        if (evidenceCitations.has(evidenceKey)) {
          throw new ConfigurationError('Episode plan audit coverage contains duplicate output evidence');
        }
        evidenceCitations.add(evidenceKey);
        const output = outputByRef.get(evidence.outputRef);
        if (output === undefined) {
          recordCitationDiagnostic({
            pageId,
            checkIndex,
            evidenceIndex,
            kind: 'output',
            ref: 'unknown',
            refKnown: false,
            reason: 'unknown_ref',
            validRefs: [...outputByRef.keys()],
          });
          continue;
        } else if (output.panelOrder === null) {
          throw new ConfigurationError('Episode plan audit coverage output quote is not exact');
        }
        if (!output.text.includes(evidence.quote)) {
          recordCitationDiagnostic({
            pageId,
            checkIndex,
            evidenceIndex,
            kind: 'output',
            ref: evidence.outputRef,
            refKnown: true,
            reason: 'not_exact',
          });
        }
      }

      if (check.status === 'present') {
        if (
          check.outputEvidence.length === 0
          || check.issueCode !== null
          || check.repairTarget !== null
        ) {
          throw new ConfigurationError('Present source coverage requires evidence and no repair');
        }
        continue;
      }

      if (
        check.outputEvidence.length !== 0
        || check.issueCode === null
        || check.repairTarget === null
        || check.repairTarget.pageId !== pageId
      ) {
        throw new ConfigurationError('Missing source coverage requires a same-page issue and repair');
      }
      const knownPanelOrders = new Set(
        pageCatalog.outputs
          .map((output) => output.panelOrder)
          .filter((panelOrder): panelOrder is number => panelOrder !== null),
      );
      if (!knownPanelOrders.has(check.repairTarget.panelOrder)) {
        throw new ConfigurationError('Missing source coverage referenced an unknown panel');
      }
      const linkedIssue = audit.issues.some((issue) =>
        issue.code === check.issueCode
        && issue.severity === 'error'
        && issue.pageIds.includes(pageId),
      );
      if (!linkedIssue || !hasRepairTarget(audit, check.repairTarget)) {
        throw new ConfigurationError('Missing source coverage is not linked to an error and repair');
      }
    }
  }

  if (citationErrorCount > 0) {
    throw new EpisodePlanAuditCoverageError(
      'Episode plan audit coverage contains invalid citations',
      buildCitationRetryInstruction(citationDiagnostics, citationErrorCount),
    );
  }
}

function buildCitationRetryInstruction(
  diagnostics: readonly CitationDiagnostic[],
  totalCount: number,
): string {
  const rule = 'Fix every listed citation by copying one contiguous 4 to 40 character substring from the exact named ref in the unchanged base input. Do not paraphrase, join fields, translate, pad short text, or add ellipsis.';
  const diagnosticRows = diagnostics.map((diagnostic, index) => {
    const refLabel = diagnostic.kind === 'source' ? 'source_ref' : 'output_ref';
    const validRefs = diagnostic.validRefs === undefined
      ? ''
      : ` valid_refs=${JSON.stringify(diagnostic.validRefs.slice(0, 12).map((ref) => boundedRef(ref)))}`;
    return `diagnostic[${index + 1}]: page_id=${boundedPageId(diagnostic.pageId)} `
      + `check_index=${diagnostic.checkIndex} `
      + `${diagnostic.evidenceIndex === null ? '' : `evidence_index=${diagnostic.evidenceIndex} `}`
      + `kind=${diagnostic.kind} `
      + `ref_known=${diagnostic.refKnown} `
      + `${refLabel}=${JSON.stringify(boundedRef(diagnostic.ref))} `
      + `reason=${diagnostic.reason}${validRefs}`;
  });
  const selectedRows: string[] = [];
  for (const row of diagnosticRows) {
    const candidateRows = [...selectedRows, row];
    const candidate = formatCitationRetryInstruction(rule, candidateRows, totalCount);
    if (candidate.length <= MAX_CITATION_RETRY_CHARS) {
      selectedRows.push(row);
    }
  }
  return formatCitationRetryInstruction(rule, selectedRows, totalCount);
}

function formatCitationRetryInstruction(
  rule: string,
  rows: readonly string[],
  totalCount: number,
): string {
  return [
    `Coverage correction for the retry: citation_errors=${totalCount}; `
      + `shown_diagnostics=${rows.length}; omitted_diagnostics=${Math.max(0, totalCount - rows.length)}.`,
    rule,
    ...rows,
  ].join('\n');
}

function boundedRef(value: string): string {
  return value.slice(0, EPISODE_PLAN_AUDIT_COVERAGE_REF_MAX_CHARS);
}

function boundedPageId(pageId: string): string {
  return JSON.stringify(pageId.slice(0, 100));
}

function uniqueByPage<TValue extends { pageId: string }>(
  values: readonly TValue[],
  label: string,
): Map<string, TValue> {
  const result = new Map<string, TValue>();
  for (const value of values) {
    if (result.has(value.pageId)) {
      throw new ConfigurationError(`Episode plan audit ${label} contains a duplicate page`);
    }
    result.set(value.pageId, value);
  }
  return result;
}

function uniqueByRef<TValue extends { ref: string }>(
  values: readonly TValue[],
  pageId: string,
  label: string,
): Map<string, TValue> {
  const result = new Map<string, TValue>();
  for (const value of values) {
    if (result.has(value.ref)) {
      throw new ConfigurationError(`Episode plan audit ${label} catalog contains a duplicate ref on ${pageId}`);
    }
    result.set(value.ref, value);
  }
  return result;
}

function hasRepairTarget(
  audit: EpisodePlanAudit,
  target: NonNullable<
    NonNullable<EpisodePlanAudit['sourceCoverage']>[number]['checks'][number]['repairTarget']
  >,
): boolean {
  const contentFields = new Set([
    'situationText',
    'composition',
    'dialogue',
    'sfxText',
    'backgroundNote',
    'panelNotes',
    'entities',
  ]);
  return (audit.panelRepairs ?? []).some((repair) =>
    repair.pageId === target.pageId
    && repair.panelOrder === target.panelOrder
    && repair.changedFields.some((field) =>
      contentFields.has(field) && repairFieldAddsVisibleContent(repair, field),
    ),
  );
}

function repairFieldAddsVisibleContent(
  repair: NonNullable<EpisodePlanAudit['panelRepairs']>[number],
  field: NonNullable<EpisodePlanAudit['panelRepairs']>[number]['changedFields'][number],
): boolean {
  switch (field) {
    case 'situationText':
      return hasText(repair.patch.situationText);
    case 'composition':
      return repair.patch.composition !== undefined;
    case 'dialogue':
      return (repair.patch.dialogue?.length ?? 0) > 0;
    case 'sfxText':
      return hasText(repair.patch.sfxText);
    case 'backgroundNote':
      return hasText(repair.patch.backgroundNote);
    case 'panelNotes':
      return hasText(repair.patch.panelNotes);
    case 'entities':
      return (repair.patch.entities?.length ?? 0) > 0;
    case 'panelRole':
    case 'panelSize':
    case 'dialogueInPanel':
      return false;
  }
}

function hasText(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim().length > 0;
}
