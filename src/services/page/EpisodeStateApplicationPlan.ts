import type {
  EpisodePagePlanContext,
  EpisodePagePlanSuggestion,
} from '../../domain/types/page.js';
import type {
  EpisodeStartingEntityState,
  EpisodeStateTransition,
  StateAssignmentPolicy,
} from '../../domain/types/episodeStateTransition.js';
import type { PanelEntityAssignment } from '../../domain/types/panelEntityAssignment.js';
import { EpisodeStatePlanError, resolveEpisodeStateAssignments } from './EpisodeStateAssignmentResolver.js';

export interface ResolveEpisodePlanStateAssignmentsInput {
  pages: ReadonlyArray<Pick<EpisodePagePlanContext['pages'][number], 'pageId' | 'pageNumber'> & {
    panels: ReadonlyArray<Pick<EpisodePagePlanContext['pages'][number]['panels'][number], 'id' | 'order' | 'entities'>>;
  }>;
  suggestion: EpisodePagePlanSuggestion;
  startingStates: readonly EpisodeStartingEntityState[];
  transitions: readonly EpisodeStateTransition[];
  policy: StateAssignmentPolicy;
}

/** Resolves states on the final planned character list before any page or assignment is saved. */
export function resolveEpisodePlanStateAssignments(
  input: ResolveEpisodePlanStateAssignmentsInput,
): ReadonlyMap<string, readonly PanelEntityAssignment[]> {
  const suggestionsByPageId = new Map(input.suggestion.pages.map((page) => [page.pageId, page] as const));
  if (suggestionsByPageId.size !== input.pages.length || input.suggestion.pages.length !== input.pages.length) {
    throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state plan has incomplete pages');
  }

  const existingAssignmentsByPanelId = new Map<string, readonly PanelEntityAssignment[]>();
  const panels = input.pages.flatMap((page) => {
    const suggestion = suggestionsByPageId.get(page.pageId);
    if (suggestion === undefined) {
      throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state plan is missing a page');
    }
    const suggestedPanelsByOrder = new Map(suggestion.panels.map((panel) => [panel.order, panel] as const));
    if (suggestedPanelsByOrder.size !== page.panels.length || suggestion.panels.length !== page.panels.length) {
      throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state plan has incomplete panels');
    }
    return page.panels.map((panel) => {
      const proposed = suggestedPanelsByOrder.get(panel.order);
      if (proposed === undefined) {
        throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state plan is missing a panel');
      }
      existingAssignmentsByPanelId.set(panel.id, panel.entities);
      return {
        panelId: panel.id,
        pageNumber: page.pageNumber,
        order: panel.order,
        assignments: proposed.entities !== undefined
          ? proposed.entities
          : panel.entities,
      };
    });
  });

  const resolved = input.policy === 'preserve_existing'
    ? resolveEpisodeStateAssignments({
        panels,
        startingStates: input.startingStates,
        transitions: input.transitions,
        policy: input.policy,
        existingAssignmentsByPanelId,
      })
    : resolveEpisodeStateAssignments({
        panels,
        startingStates: input.startingStates,
        transitions: input.transitions,
        policy: input.policy,
      });
  return new Map(resolved.map((panel) => [panel.panelId, panel.assignments] as const));
}
