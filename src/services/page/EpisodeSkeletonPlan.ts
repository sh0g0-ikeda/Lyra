import { randomUUID } from 'node:crypto';
import { buildPanelFrameTemplateInputs } from '../../domain/constants/panelFrameTemplates.js';
import { ConflictError, ValidationError } from '../../domain/errors/index.js';
import type {
  EpisodePagePlanContext,
  EpisodePagePlanSuggestion,
  PageAutofillPanelContext,
} from '../../domain/types/page.js';
import type { PanelEntityAssignment } from '../../domain/types/panelEntityAssignment.js';
import type { PageSkeletonPageDraft } from '../../domain/types/storyAi.js';

export function buildVirtualEpisodePlanContext(
  baseContext: EpisodePagePlanContext,
  skeletonPages: PageSkeletonPageDraft[],
  createId: () => string = randomUUID,
): EpisodePagePlanContext {
  return {
    ...baseContext,
    pages: skeletonPages.map((page) => {
      const frameDefinitions = buildPanelFrameTemplateInputs(page.suggestedLayout);
      if (
        frameDefinitions.length !== page.suggestedPanelCount ||
        page.panels.length !== page.suggestedPanelCount
      ) {
        throw new ValidationError('Page skeleton panel and frame counts must match');
      }

      return {
        pageId: createId(),
        pageNumber: page.pageNumber,
        frameCount: frameDefinitions.length,
        layoutConfig: {
          type: 'template',
          template_id: page.suggestedLayout,
          panel_count: page.suggestedPanelCount,
          frame_definitions: frameDefinitions,
        },
        status: 'designing' as const,
        dialogueMode: 'image_baked' as const,
        pageDialogueToggle: true,
        panels: page.panels.map((panel) => buildVirtualPanel(panel, createId())),
      };
    }),
  };
}

export function remapEpisodePlanSuggestionToPersistedContext(
  virtualContext: EpisodePagePlanContext,
  persistedContext: EpisodePagePlanContext,
  suggestion: EpisodePagePlanSuggestion,
): EpisodePagePlanSuggestion {
  const virtualPagesByNumber = indexPagesByNumber(virtualContext);
  const persistedPagesByNumber = indexPagesByNumber(persistedContext);
  if (virtualPagesByNumber.size !== persistedPagesByNumber.size) {
    throw new ConflictError('Page structure changed before the story plan could be saved');
  }

  const persistedPageIdByVirtualId = new Map<string, string>();
  for (const [pageNumber, virtualPage] of virtualPagesByNumber.entries()) {
    const persistedPage = persistedPagesByNumber.get(pageNumber);
    if (
      persistedPage === undefined ||
      persistedPage.frameCount !== virtualPage.frameCount ||
      !samePanelOrders(virtualPage.panels, persistedPage.panels)
    ) {
      throw new ConflictError('Page structure changed before the story plan could be saved');
    }
    persistedPageIdByVirtualId.set(virtualPage.pageId, persistedPage.pageId);
  }

  return {
    pages: suggestion.pages.map((page) => {
      const persistedPageId = persistedPageIdByVirtualId.get(page.pageId);
      const virtualPage = virtualPagesByNumber.get(page.pageNumber);
      if (persistedPageId === undefined || virtualPage?.pageId !== page.pageId) {
        throw new ValidationError('Episode page plan referenced an unknown virtual page');
      }
      return { ...page, pageId: persistedPageId };
    }),
  };
}

function buildVirtualPanel(
  panel: PageSkeletonPageDraft['panels'][number],
  panelId: string,
): PageAutofillPanelContext {
  return {
    id: panelId,
    order: panel.order,
    panelRole: panel.panelRole,
    panelSize: panel.suggestedSize,
    situationText: panel.situationHint,
    composition: {
      source: 'ai_auto',
      galleryItemId: null,
      compositionPrompt: null,
      shotType: null,
      angle: null,
      customNote: null,
    },
    dialogueInPanel: true,
    dialogue: [],
    sfxText: null,
    backgroundNote: null,
    panelNotes: panel.suggestedDialogueHint,
    entities: panel.suggestedEntities.map((entityId, index) =>
      buildVirtualAssignment(entityId, index),
    ),
  };
}

function buildVirtualAssignment(entityId: string, index: number): PanelEntityAssignment {
  return {
    entityId,
    role: index === 0 ? 'primary' : 'secondary',
    expression: 'calm',
    customExpression: null,
    action: 'standing_firm',
    customAction: null,
    position: index === 0 ? 'center' : index === 1 ? 'left' : index === 2 ? 'right' : 'background',
    facingDirection: null,
    effectNote: null,
    stateId: null,
  };
}

function indexPagesByNumber(
  context: EpisodePagePlanContext,
): Map<number, EpisodePagePlanContext['pages'][number]> {
  const result = new Map<number, EpisodePagePlanContext['pages'][number]>();
  for (const page of context.pages) {
    if (result.has(page.pageNumber)) {
      throw new ValidationError('Episode page plan contains duplicate page numbers');
    }
    result.set(page.pageNumber, page);
  }
  return result;
}

function samePanelOrders(
  left: EpisodePagePlanContext['pages'][number]['panels'],
  right: EpisodePagePlanContext['pages'][number]['panels'],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftOrders = left.map((panel) => panel.order).sort((a, b) => a - b);
  const rightOrders = right.map((panel) => panel.order).sort((a, b) => a - b);
  return leftOrders.every((order, index) => order === rightOrders[index]);
}
