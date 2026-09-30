import {
  MAX_EPISODE_STATE_SOURCE_QUOTE_CHARS,
  MAX_EPISODE_STATE_TRANSITIONS,
  MAX_EPISODE_STATE_JOB_BLOCKER_CANDIDATES,
} from '../../domain/constants/storyState.js';
import type {
  EpisodeStateTransition,
  EpisodeStateTransitionPlan,
  EpisodeStateTransitionSourceField,
} from '../../domain/types/episodeStateTransition.js';
import type { EpisodePagePlanContext } from '../../domain/types/page.js';
import { EpisodeStatePlanError } from './EpisodeStateAssignmentResolver.js';

/** Validates model-proposed boundaries against saved story inputs before any assignment is changed. */
export function validateEpisodeStateTransitionPlan(
  context: EpisodePagePlanContext,
  plan: EpisodeStateTransitionPlan,
): EpisodeStateTransition[] {
  if (plan.transitions.length + plan.unresolved.length > MAX_EPISODE_STATE_TRANSITIONS) {
    throw new EpisodeStatePlanError('LIMIT_EXCEEDED', 'Episode state plan exceeds its limit');
  }
  if (context.stateLibrary === undefined) {
    throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state library is unavailable');
  }

  const entityIds = new Set(context.entities.map((entity) => entity.id));
  const stateById = new Map(context.stateLibrary.map((state) => [state.stateId, state] as const));
  const panelPosition = new Map<string, number>();
  for (const [index, panel] of [...context.pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .flatMap((page) => [...page.panels]
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry)).entries()) {
    if (panelPosition.has(panel.id)) {
      throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode repeats a panel ID');
    }
    panelPosition.set(panel.id, index);
  }

  for (const startingState of context.episode.startingEntityStates ?? []) {
    validateEntityAndState(startingState.entityId, startingState.stateId, entityIds, stateById);
  }

  if (plan.unresolved.length > 0) {
    for (const candidate of plan.unresolved) {
      validateSource(context, candidate, entityIds, panelPosition);
      if (candidate.candidateStateId !== null) {
        const state = stateById.get(candidate.candidateStateId);
        if (state === undefined || state.entityId !== candidate.entityId
          || (candidate.reason === 'missing_reference' && state.referenceReady)) {
          throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Unresolved state candidate is invalid');
        }
      }
      if (candidate.suggestedName.length === 0 || candidate.suggestedName.length > 100
        || candidate.suggestedDescription.length === 0
        || candidate.suggestedDescription.length > 2_000) {
        throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Unresolved state suggestion is invalid');
      }
    }
    throw new EpisodeStatePlanError(
      plan.unresolved.some((candidate) => candidate.reason === 'ambiguous_mapping')
        ? 'STATE_MAPPING_AMBIGUOUS'
        : 'STATE_REFERENCE_REQUIRED',
      'Episode needs a confirmed character state before story autofill can be applied',
      plan.unresolved.slice(0, MAX_EPISODE_STATE_JOB_BLOCKER_CANDIDATES),
    );
  }

  const seenBoundaries = new Set<string>();
  let previousPosition = -1;
  for (const transition of plan.transitions) {
    validateSource(context, transition, entityIds, panelPosition);
    validateEntityAndState(transition.entityId, transition.stateId, entityIds, stateById);
    const position = panelPosition.get(transition.startsAtPanelId)!;
    const key = `${transition.startsAtPanelId}:${transition.entityId}`;
    if (position < previousPosition || seenBoundaries.has(key)) {
      throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state boundaries are duplicated or out of order');
    }
    previousPosition = position;
    seenBoundaries.add(key);
  }

  return plan.transitions.map((transition) => ({ ...transition }));
}

function validateEntityAndState(
  entityId: string,
  stateId: string | null,
  entityIds: ReadonlySet<string>,
  stateById: ReadonlyMap<string, NonNullable<EpisodePagePlanContext['stateLibrary']>[number]>,
): void {
  if (!entityIds.has(entityId)) {
    throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state references an unknown entity');
  }
  if (stateId === null) {
    return;
  }
  const state = stateById.get(stateId);
  if (state === undefined || state.entityId !== entityId) {
    throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state does not belong to the entity');
  }
  if (!state.referenceReady || state.referenceImage === null) {
    throw new EpisodeStatePlanError('STATE_REFERENCE_REQUIRED', 'Episode state has no current confirmed reference');
  }
}

function validateSource(
  context: EpisodePagePlanContext,
  source: Pick<EpisodeStateTransition, 'entityId' | 'startsAtPanelId' | 'sourceSceneId' | 'sourceField' | 'sourceQuote'>,
  entityIds: ReadonlySet<string>,
  panelPosition: ReadonlyMap<string, number>,
): void {
  if (!entityIds.has(source.entityId) || !panelPosition.has(source.startsAtPanelId)) {
    throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state source references an unknown ID');
  }
  if (source.sourceQuote.length === 0
    || source.sourceQuote.length > MAX_EPISODE_STATE_SOURCE_QUOTE_CHARS) {
    throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state source quote is invalid');
  }
  const savedText = sourceText(context, source.sourceField, source.sourceSceneId);
  const quote = normalizeSourceText(source.sourceQuote);
  if (savedText === null || quote.length === 0 || !normalizeSourceText(savedText).includes(quote)) {
    throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state quote is not present in the saved story');
  }
}

function sourceText(
  context: EpisodePagePlanContext,
  field: EpisodeStateTransitionSourceField,
  sceneId: string | null,
): string | null {
  if (field.startsWith('scene_')) {
    const scene = context.scenes.find((item) => item.id === sceneId);
    if (scene === undefined) {
      return null;
    }
    switch (field) {
      case 'scene_location': return scene.location;
      case 'scene_time': return scene.time;
      case 'scene_atmosphere': return scene.atmosphere;
    }
  }
  if (sceneId !== null) {
    return null;
  }
  switch (field) {
    case 'story_full_draft': return context.episode.storyFullDraft ?? null;
    case 'introduction': return context.episode.introduction;
    case 'middle': return context.episode.middle;
    case 'climax': return context.episode.climax;
    case 'ending_hook': return context.episode.endingHook;
    default: return null;
  }
}

function normalizeSourceText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
