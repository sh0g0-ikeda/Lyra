import type {
  EpisodePagePlanContext,
  EpisodePagePlanSuggestion,
} from '../../domain/types/page.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type {
  EpisodeStartingEntityState,
  EpisodeStateTransition,
  EpisodeUnresolvedStateTransition,
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
  allowUnassignedStateFill?: boolean;
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
        allowUnassignedStateFill: input.allowUnassignedStateFill,
      })
    : resolveEpisodeStateAssignments({
        panels,
        startingStates: input.startingStates,
        transitions: input.transitions,
        policy: input.policy,
      });
  return new Map(resolved.map((panel) => [panel.panelId, panel.assignments] as const));
}

export interface ApplyEpisodeStateVisualDirectivesInput {
  context: EpisodePagePlanContext;
  suggestion: EpisodePagePlanSuggestion;
  transitions: readonly EpisodeStateTransition[];
  visualFallbacks: readonly EpisodeUnresolvedStateTransition[];
  language: AppLanguage;
}

interface ActiveVisualState {
  registered: string | null;
  overlay: string | null;
}

// Keep deterministic augmentation inside the same public panel contract enforced by panel.schema.ts.
const PANEL_SITUATION_TEXT_MAX_CHARS = 2_000;
const PANEL_COMPOSITION_PROMPT_MAX_CHARS = 1_000;

/**
 * Adds source-validated state appearance to generated panel text without creating state records.
 * Registered state assignment and visual-only overlay timelines remain independent: an unresolved
 * injury or costume detail never clears the current READY state reference.
 */
export function applyEpisodeStateVisualDirectives(
  input: ApplyEpisodeStateVisualDirectivesInput,
): EpisodePagePlanSuggestion {
  const entityById = new Map(input.context.entities.map((entity) => [entity.id, entity] as const));
  const stateById = new Map((input.context.stateLibrary ?? []).map((state) => [state.stateId, state] as const));
  const transitionsByPanel = groupByPanel(input.transitions);
  const fallbacksByPanel = groupByPanel(input.visualFallbacks);
  const activeByEntity = new Map<string, ActiveVisualState>();
  for (const starting of input.context.episode.startingEntityStates ?? []) {
    activeByEntity.set(starting.entityId, {
      registered: describeRegisteredState(starting.stateId, starting.entityId, stateById),
      overlay: null,
    });
  }

  const suggestionByPageId = new Map(input.suggestion.pages.map((page) => [page.pageId, page] as const));
  const pages = [...input.context.pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((contextPage) => {
      const suggestionPage = suggestionByPageId.get(contextPage.pageId);
      if (suggestionPage === undefined) {
        throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode visual state plan is missing a page');
      }
      const panelByOrder = new Map(suggestionPage.panels.map((panel) => [panel.order, panel] as const));
      const panels = [...contextPage.panels]
        .sort((left, right) => left.order - right.order)
        .map((contextPanel) => {
          const panel = panelByOrder.get(contextPanel.order);
          if (panel === undefined) {
            throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode visual state plan is missing a panel');
          }
          for (const transition of transitionsByPanel.get(contextPanel.id) ?? []) {
            activeByEntity.set(transition.entityId, {
              registered: describeRegisteredState(transition.stateId, transition.entityId, stateById),
              overlay: null,
            });
          }
          for (const fallback of fallbacksByPanel.get(contextPanel.id) ?? []) {
            const current = activeByEntity.get(fallback.entityId) ?? { registered: null, overlay: null };
            activeByEntity.set(fallback.entityId, {
              ...current,
              overlay: describeVisualFallback(fallback),
            });
          }

          const assignments = panel.entities ?? contextPanel.entities;
          const directives = assignments.flatMap((assignment) => {
            const active = activeByEntity.get(assignment.entityId);
            if (active === undefined || (active.registered === null && active.overlay === null)) {
              return [];
            }
            const entityName = entityById.get(assignment.entityId)?.name ?? assignment.entityId;
            const details = [active.registered, active.overlay].filter((value): value is string => value !== null);
            const prefix = input.language === 'ja' ? '物語上の外見' : 'Story appearance';
            return [`[${prefix}: ${normalizeDirectiveText(entityName)} — ${details.join('; ')}]`];
          });
          if (directives.length === 0) {
            return { ...panel };
          }
          const directive = directives.join(' ');
          return {
            ...panel,
            situationText: appendDirective(
              panel.situationText,
              directive,
              PANEL_SITUATION_TEXT_MAX_CHARS,
              'situation text',
            ),
            composition: {
              ...(panel.composition ?? {}),
              compositionPrompt: appendDirective(
                panel.composition?.compositionPrompt,
                directive,
                PANEL_COMPOSITION_PROMPT_MAX_CHARS,
                'composition prompt',
              ),
            },
          };
        });
      return { ...suggestionPage, panels };
    });
  return { pages };
}

function groupByPanel<T extends { startsAtPanelId: string }>(
  entries: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    const current = grouped.get(entry.startsAtPanelId) ?? [];
    current.push(entry);
    grouped.set(entry.startsAtPanelId, current);
  }
  return grouped;
}

function describeRegisteredState(
  stateId: string | null,
  entityId: string,
  stateById: ReadonlyMap<string, NonNullable<EpisodePagePlanContext['stateLibrary']>[number]>,
): string | null {
  if (stateId === null) return null;
  const state = stateById.get(stateId);
  if (
    state === undefined
    || state.entityId !== entityId
    || !state.referenceReady
    || state.referenceImage === null
    || typeof state.name !== 'string'
    || state.name.trim().length === 0
  ) {
    throw new EpisodeStatePlanError('STATE_REFERENCE_REQUIRED', 'Episode state has no current confirmed reference');
  }
  // The confirmed state reference carries the full registered appearance into image generation.
  // Keep only its short label in editable panel text so a valid long description cannot exhaust
  // the public situation/composition limits on every panel.
  return normalizeDirectiveText(state.name);
}

function describeVisualFallback(fallback: EpisodeUnresolvedStateTransition): string {
  // An unready candidate has no usable reference and its catalog description can be both stale and
  // much longer than the source-grounded visible delta compiled for this exact story boundary.
  return normalizeDirectiveText(`${fallback.suggestedName}: ${fallback.suggestedDescription}`);
}

function normalizeDirectiveText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').replace(/\]/gu, '）').trim();
}

function appendDirective(
  value: string | null | undefined,
  directive: string,
  maxChars: number,
  fieldName: string,
): string {
  const current = value?.trim() ?? '';
  const augmented = current.includes(directive)
    ? current
    : current.length === 0 ? directive : `${current}\n${directive}`;
  if (augmented.length > maxChars) {
    throw new EpisodeStatePlanError(
      'STATE_PLAN_INVALID',
      `Episode visual state ${fieldName} exceeds the saved panel limit`,
    );
  }
  return augmented;
}
