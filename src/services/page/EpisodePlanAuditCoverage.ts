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

    for (const check of pageCoverage.checks) {
      const checkKey = `${check.sourceRef}\u0000${check.sourceQuote}`;
      if (seenChecks.has(checkKey)) {
        throw new ConfigurationError('Episode plan audit coverage contains a duplicate check');
      }
      seenChecks.add(checkKey);

      const source = sourceByRef.get(check.sourceRef);
      if (source === undefined) {
        throw new EpisodePlanAuditCoverageError(
          'Episode plan audit coverage referenced an unknown source',
          buildUnknownRefRetryInstruction('source', pageId, check.sourceRef, sourceByRef.keys()),
        );
      }
      if (!source.text.includes(check.sourceQuote)) {
        throw new EpisodePlanAuditCoverageError(
          'Episode plan audit coverage source quote is not exact',
          `Coverage correction for the retry: page_id=${boundedPageId(pageId)} `
            + `source_ref=${JSON.stringify(check.sourceRef)} `
            + `source_quote=${JSON.stringify(check.sourceQuote)} is not one contiguous exact substring `
            + 'of that named source. Copy 4 to 40 displayed characters without paraphrasing, joining spans, or adding ellipsis.',
        );
      }

      const evidenceCitations = new Set<string>();
      for (const evidence of check.outputEvidence) {
        const evidenceKey = `${evidence.outputRef}\u0000${evidence.quote}`;
        if (evidenceCitations.has(evidenceKey)) {
          throw new ConfigurationError('Episode plan audit coverage contains duplicate output evidence');
        }
        evidenceCitations.add(evidenceKey);
        const output = outputByRef.get(evidence.outputRef);
        if (output === undefined) {
          throw new EpisodePlanAuditCoverageError(
            'Episode plan audit coverage referenced an unknown output',
            buildUnknownRefRetryInstruction('output', pageId, evidence.outputRef, outputByRef.keys()),
          );
        }
        if (output.panelOrder === null) {
          throw new ConfigurationError('Episode plan audit coverage output quote is not exact');
        }
        if (!output.text.includes(evidence.quote)) {
          throw new EpisodePlanAuditCoverageError(
            'Episode plan audit coverage output quote is not exact',
            `Coverage correction for the retry: page_id=${boundedPageId(pageId)} `
              + `output_ref=${JSON.stringify(evidence.outputRef)} `
              + `quote=${JSON.stringify(evidence.quote)} is not one contiguous exact substring of that `
              + 'citable output prefix. Copy 4 to 40 displayed literal characters and never copy a synthetic trailing ellipsis.',
          );
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
}

function buildUnknownRefRetryInstruction(
  kind: 'source' | 'output',
  pageId: string,
  invalidRef: string,
  validRefs: Iterable<string>,
): string {
  const boundedRefs = [...validRefs]
    .slice(0, 12)
    .map((ref) => JSON.stringify(ref.slice(0, EPISODE_PLAN_AUDIT_COVERAGE_REF_MAX_CHARS)))
    .join(', ');
  return `Coverage correction for the retry: page_id=${boundedPageId(pageId)} `
    + `${kind}_ref=${JSON.stringify(invalidRef)} is unknown for this page. `
    + `Choose the exact named ref from this bounded list: ${boundedRefs}. Do not rename or infer a ref.`;
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
