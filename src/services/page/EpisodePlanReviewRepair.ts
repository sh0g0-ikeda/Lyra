import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  EpisodePagePlanPageSuggestion,
  EpisodePagePlanSuggestion,
  PageAutofillPanelSuggestion,
} from '../../domain/types/page.js';
import type {
  EpisodePlanAudit,
  EpisodePlanAuditIssue,
  EpisodePlanAuditPageRepair,
  EpisodePlanAuditPageRepairField,
  EpisodePlanAuditPanelRepair,
  EpisodePlanAuditPanelRepairField,
} from './EpisodePlanAuditCompiler.js';

export interface ApplyEpisodePlanAuditRepairsInput {
  suggestion: EpisodePagePlanSuggestion;
  audit: EpisodePlanAudit;
  knownPanelOrdersByPageId: ReadonlyMap<string, ReadonlySet<number>>;
}

export function hasBlockingEpisodePlanAuditIssues(
  issues: readonly EpisodePlanAuditIssue[],
): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

export function applyEpisodePlanAuditRepairs(
  input: ApplyEpisodePlanAuditRepairsInput,
): EpisodePagePlanSuggestion {
  const repaired = cloneEpisodePlanSuggestion(input.suggestion);
  const pagesById = new Map(repaired.pages.map((page) => [page.pageId, page] as const));
  const errorPageIds = new Set(
    input.audit.issues
      .filter((issue) => issue.severity === 'error')
      .flatMap((issue) => issue.pageIds),
  );
  const appliedFields = new Set<string>();

  for (const repair of input.audit.pageRepairs ?? []) {
    assertRepairPageAllowed(repair.pageId, errorPageIds, pagesById);
    const page = pagesById.get(repair.pageId)!;
    for (const field of repair.changedFields) {
      assertUniqueRepairField(appliedFields, `page:${repair.pageId}:${field}`);
      applyPageRepairField(page, repair, field);
    }
  }

  for (const repair of input.audit.panelRepairs ?? []) {
    assertRepairPageAllowed(repair.pageId, errorPageIds, pagesById);
    const knownPanelOrders = input.knownPanelOrdersByPageId.get(repair.pageId);
    if (knownPanelOrders === undefined || !knownPanelOrders.has(repair.panelOrder)) {
      throw new ConfigurationError('Episode plan audit repair referenced an unknown panel');
    }

    const panel = pagesById
      .get(repair.pageId)!
      .panels.find((candidate) => candidate.order === repair.panelOrder);
    if (panel === undefined) {
      throw new ConfigurationError('Episode plan audit repair referenced a missing draft panel');
    }

    for (const field of repair.changedFields) {
      assertUniqueRepairField(
        appliedFields,
        `panel:${repair.pageId}:${repair.panelOrder}:${field}`,
      );
      applyPanelRepairField(panel, repair, field);
    }
  }

  return repaired;
}

function assertRepairPageAllowed(
  pageId: string,
  errorPageIds: ReadonlySet<string>,
  pagesById: ReadonlyMap<string, EpisodePagePlanPageSuggestion>,
): void {
  if (!pagesById.has(pageId)) {
    throw new ConfigurationError('Episode plan audit repair referenced an unknown page');
  }
  if (!errorPageIds.has(pageId)) {
    throw new ConfigurationError('Episode plan audit repair targeted a page without an error');
  }
}

function assertUniqueRepairField(appliedFields: Set<string>, key: string): void {
  if (appliedFields.has(key)) {
    throw new ConfigurationError('Episode plan audit repair changed the same field more than once');
  }
  appliedFields.add(key);
}

function applyPageRepairField(
  page: EpisodePagePlanPageSuggestion,
  repair: EpisodePlanAuditPageRepair,
  field: EpisodePlanAuditPageRepairField,
): void {
  if (!Object.hasOwn(repair.patch, field)) {
    throw new ConfigurationError(`Episode plan audit repair omitted ${field}`);
  }

  switch (field) {
    case 'sourceSceneIds':
      page.sourceSceneIds = [...repair.patch.sourceSceneIds!];
      return;
    case 'pagePurpose':
      page.pagePurpose = repair.patch.pagePurpose;
      return;
    case 'continuityNote':
      page.continuityNote = repair.patch.continuityNote;
      return;
    case 'dialogueMode':
      page.page = { ...page.page, dialogueMode: repair.patch.dialogueMode! };
      return;
    case 'pageDialogueToggle':
      page.page = { ...page.page, pageDialogueToggle: repair.patch.pageDialogueToggle! };
      return;
  }
}

function applyPanelRepairField(
  panel: PageAutofillPanelSuggestion,
  repair: EpisodePlanAuditPanelRepair,
  field: EpisodePlanAuditPanelRepairField,
): void {
  if (!Object.hasOwn(repair.patch, field)) {
    throw new ConfigurationError(`Episode plan audit repair omitted ${field}`);
  }

  switch (field) {
    case 'panelRole':
      panel.panelRole = repair.patch.panelRole;
      return;
    case 'panelSize':
      panel.panelSize = repair.patch.panelSize;
      return;
    case 'situationText':
      panel.situationText = repair.patch.situationText;
      return;
    case 'composition':
      panel.composition = repair.patch.composition === undefined
        ? undefined
        : { ...repair.patch.composition };
      return;
    case 'dialogueInPanel':
      panel.dialogueInPanel = repair.patch.dialogueInPanel;
      return;
    case 'dialogue':
      panel.dialogue = repair.patch.dialogue?.map((line) => ({ ...line }));
      return;
    case 'sfxText':
      panel.sfxText = repair.patch.sfxText;
      return;
    case 'backgroundNote':
      panel.backgroundNote = repair.patch.backgroundNote;
      return;
    case 'panelNotes':
      panel.panelNotes = repair.patch.panelNotes;
      return;
    case 'entities':
      panel.entities = repair.patch.entities?.map((entity) => ({ ...entity }));
      return;
  }
}

function cloneEpisodePlanSuggestion(
  suggestion: EpisodePagePlanSuggestion,
): EpisodePagePlanSuggestion {
  return {
    pages: suggestion.pages.map((page) => ({
      ...page,
      sourceSceneIds: page.sourceSceneIds === undefined ? undefined : [...page.sourceSceneIds],
      page: page.page === undefined ? undefined : { ...page.page },
      panels: page.panels.map((panel) => ({
        ...panel,
        composition: panel.composition === undefined ? undefined : { ...panel.composition },
        dialogue: panel.dialogue?.map((line) => ({ ...line })),
        entities: panel.entities?.map((entity) => ({ ...entity })),
      })),
    })),
  };
}
