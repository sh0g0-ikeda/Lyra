import { ValidationError } from '../../domain/errors/index.js';
import type {
  EpisodePagePlanContext,
  EpisodePagePlanPageSuggestion,
  EpisodePagePlanSuggestion,
  PageAutofillPanelSuggestion,
} from '../../domain/types/page.js';

export interface RepairEpisodePlanIdentifierReferencesInput {
  context: EpisodePagePlanContext;
  candidate: EpisodePagePlanSuggestion;
  trustedFallback: EpisodePagePlanSuggestion;
}

export interface RepairEpisodePlanIdentifierReferencesResult {
  suggestion: EpisodePagePlanSuggestion;
  revertedPanelIdentifierBundleCount: number;
  revertedSourceSceneCount: number;
}

interface IdentifierAllowlist {
  entityIds: ReadonlySet<string>;
  sceneIds: ReadonlySet<string>;
  stateIdsByEntityId: ReadonlyMap<string, ReadonlySet<string>>;
}

export function repairEpisodePlanIdentifierReferences(
  input: RepairEpisodePlanIdentifierReferencesInput,
): RepairEpisodePlanIdentifierReferencesResult {
  const allowlist = buildIdentifierAllowlist(input.context);
  const suggestion = cloneEpisodePlanSuggestion(input.candidate);
  const fallbackPagesById = new Map(
    input.trustedFallback.pages.map((page) => [page.pageId, page] as const),
  );
  const fallbackPagesByNumber = new Map(
    input.trustedFallback.pages.map((page) => [page.pageNumber, page] as const),
  );
  let revertedPanelIdentifierBundleCount = 0;
  let revertedSourceSceneCount = 0;

  for (const page of suggestion.pages) {
    const fallbackPage =
      fallbackPagesById.get(page.pageId) ?? fallbackPagesByNumber.get(page.pageNumber);

    if (!hasAllowedSourceSceneIds(page.sourceSceneIds, allowlist)) {
      if (
        fallbackPage === undefined ||
        !hasAllowedSourceSceneIds(fallbackPage.sourceSceneIds, allowlist)
      ) {
        throw invalidTrustedFallbackError();
      }
      page.sourceSceneIds = cloneOptionalStringArray(fallbackPage.sourceSceneIds);
      revertedSourceSceneCount += 1;
    }

    const fallbackPanelsByOrder = new Map(
      (fallbackPage?.panels ?? []).map((panel) => [panel.order, panel] as const),
    );
    for (const panel of page.panels) {
      if (hasAllowedPanelIdentifierBundle(panel, allowlist)) {
        continue;
      }

      const fallbackPanel = fallbackPanelsByOrder.get(panel.order);
      if (
        fallbackPanel === undefined ||
        !hasAllowedPanelIdentifierBundle(fallbackPanel, allowlist)
      ) {
        throw invalidTrustedFallbackError();
      }

      panel.dialogue = cloneDialogue(fallbackPanel.dialogue);
      panel.entities = cloneAssignments(fallbackPanel.entities);
      revertedPanelIdentifierBundleCount += 1;
    }
  }

  return {
    suggestion,
    revertedPanelIdentifierBundleCount,
    revertedSourceSceneCount,
  };
}

function buildIdentifierAllowlist(context: EpisodePagePlanContext): IdentifierAllowlist {
  const stateIdsByEntityId = new Map<string, Set<string>>();
  for (const scene of context.scenes) {
    for (const state of scene.entityStates) {
      const stateIds = stateIdsByEntityId.get(state.entityId) ?? new Set<string>();
      stateIds.add(state.stateId);
      stateIdsByEntityId.set(state.entityId, stateIds);
    }
  }

  return {
    entityIds: new Set(context.entities.map((entity) => entity.id)),
    sceneIds: new Set(context.scenes.map((scene) => scene.id)),
    stateIdsByEntityId,
  };
}

function hasAllowedSourceSceneIds(
  sourceSceneIds: readonly string[] | undefined,
  allowlist: IdentifierAllowlist,
): boolean {
  return sourceSceneIds?.every((sceneId) => allowlist.sceneIds.has(sceneId)) ?? true;
}

function hasAllowedPanelIdentifierBundle(
  panel: PageAutofillPanelSuggestion,
  allowlist: IdentifierAllowlist,
): boolean {
  const dialogueAllowed =
    panel.dialogue?.every(
      (line) => line.entityId === null || allowlist.entityIds.has(line.entityId),
    ) ?? true;
  if (!dialogueAllowed) {
    return false;
  }

  const seenEntityIds = new Set<string>();
  for (const assignment of panel.entities ?? []) {
    if (!allowlist.entityIds.has(assignment.entityId)) {
      return false;
    }
    if (seenEntityIds.has(assignment.entityId)) {
      return false;
    }
    seenEntityIds.add(assignment.entityId);

    if (
      assignment.stateId !== null &&
      !allowlist.stateIdsByEntityId.get(assignment.entityId)?.has(assignment.stateId)
    ) {
      return false;
    }
  }

  return true;
}

function invalidTrustedFallbackError(): ValidationError {
  return new ValidationError(
    'Episode page plan trusted fallback contains invalid identifier references',
  );
}

function cloneEpisodePlanSuggestion(
  suggestion: EpisodePagePlanSuggestion,
): EpisodePagePlanSuggestion {
  return {
    pages: suggestion.pages.map(clonePageSuggestion),
  };
}

function clonePageSuggestion(
  page: EpisodePagePlanPageSuggestion,
): EpisodePagePlanPageSuggestion {
  return {
    ...page,
    sourceSceneIds: cloneOptionalStringArray(page.sourceSceneIds),
    page: page.page === undefined ? undefined : { ...page.page },
    panels: page.panels.map((panel) => ({
      ...panel,
      composition: panel.composition === undefined ? undefined : { ...panel.composition },
      dialogue: cloneDialogue(panel.dialogue),
      entities: cloneAssignments(panel.entities),
    })),
  };
}

function cloneOptionalStringArray(values: readonly string[] | undefined): string[] | undefined {
  return values === undefined ? undefined : [...values];
}

function cloneDialogue(
  dialogue: PageAutofillPanelSuggestion['dialogue'],
): PageAutofillPanelSuggestion['dialogue'] {
  return dialogue?.map((line) => ({ ...line }));
}

function cloneAssignments(
  assignments: PageAutofillPanelSuggestion['entities'],
): PageAutofillPanelSuggestion['entities'] {
  return assignments?.map((assignment) => ({ ...assignment }));
}
