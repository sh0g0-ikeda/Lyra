import { extractEntityAliases } from '../../domain/entityAliases.js';
import {
  assertProductionPanelConstraints,
  episodeProseFields,
  locateProductionAnchor,
  type EpisodeProductionDirective,
} from '../../domain/episodeProductionNotes.js';
import { ValidationError } from '../../domain/errors/index.js';
import type { EpisodeStateTransition, EpisodeUnresolvedStateTransition } from '../../domain/types/episodeStateTransition.js';
import type { EpisodePagePlanContext, EpisodePagePlanSuggestion } from '../../domain/types/page.js';

const sourceFieldByKey = {
  storyFullDraft: 'story_full_draft',
  introduction: 'introduction',
  middle: 'middle',
  climax: 'climax',
  endingHook: 'ending_hook',
} as const;

export function validateAndPlaceProductionDirectives(
  context: EpisodePagePlanContext,
  suggestion: EpisodePagePlanSuggestion,
  directives: readonly EpisodeProductionDirective[],
): { transitions: EpisodeStateTransition[]; unresolved: EpisodeUnresolvedStateTransition[] } {
  const panelIdByKey = new Map(context.pages.flatMap((page) =>
    page.panels.map((panel) => [`${page.pageId}:${panel.order}`, panel.id] as const)));
  const panels = suggestion.pages.flatMap((page) => page.panels.map((panel) => ({
    id: panelIdByKey.get(`${page.pageId}:${panel.order}`),
    text: [panel.situationText, ...panel.dialogue?.map((line) => line.text) ?? []],
  })));
  assertProductionPanelConstraints(panels, directives);

  const transitions: EpisodeStateTransition[] = [];
  const unresolved: EpisodeUnresolvedStateTransition[] = [];
  const usedBoundaries = new Set<string>();
  for (const directive of directives) {
    if (directive.kind !== 'state') continue;
    const { id } = locateProductionAnchor(panels, directive.at);
    const key = episodeProseFields.find((field) => context.episode[field]?.includes(directive.at) === true);
    const matchingEntities = context.entities.filter((entity) =>
      [entity.name, ...extractEntityAliases(entity.structuredFields)].includes(directive.name));
    const [entity] = matchingEntities;
    if (matchingEntities.length !== 1 || entity === undefined || id === undefined || key === undefined) {
      throw new ValidationError('Production note needs an unambiguous registered character and panel');
    }
    const boundary = `${id}:${entity.id}`;
    if (usedBoundaries.has(boundary)) throw new ValidationError('Conflicting character state notes for the same panel');
    usedBoundaries.add(boundary);
    const target = {
      startsAtPanelId: id,
      entityId: entity.id,
      sourceSceneId: null,
      sourceField: sourceFieldByKey[key],
      sourceQuote: directive.at,
    };
    if (directive.state === null) {
      transitions.push({ ...target, stateId: null });
      continue;
    }
    const matches = (context.stateLibrary ?? []).filter((state) =>
      state.entityId === entity.id && state.name === directive.state);
    const [state] = matches;
    if (matches.length !== 1 || state === undefined) {
      throw new ValidationError('Production note needs an unambiguous registered character state');
    }
    if (state.referenceReady) transitions.push({ ...target, stateId: state.stateId });
    else if (state.name !== null && state.description !== null) unresolved.push({
      ...target, candidateStateId: state.stateId, suggestedName: state.name,
      suggestedDescription: state.description, reason: 'missing_reference',
    });
    else throw new ValidationError('Production note state is missing its appearance description');
  }
  return { transitions, unresolved };
}
