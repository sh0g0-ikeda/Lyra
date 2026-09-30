import {
  MAX_EPISODE_STARTING_ENTITY_STATES,
  MAX_EPISODE_STATE_TRANSITIONS,
} from '../../domain/constants/storyState.js';
import type {
  EpisodeStartingEntityState,
  EpisodeStateTransition,
  EpisodeUnresolvedStateTransition,
  StateAssignmentPolicy,
} from '../../domain/types/episodeStateTransition.js';
import type { PanelEntityAssignment } from '../../domain/types/panelEntityAssignment.js';

export type EpisodeStatePlanErrorCode =
  | 'STATE_PLAN_INVALID'
  | 'STATE_ASSIGNMENT_CONFLICT'
  | 'STATE_REFERENCE_REQUIRED'
  | 'STATE_MAPPING_AMBIGUOUS'
  | 'LIMIT_EXCEEDED';

export class EpisodeStatePlanError extends Error {
  public constructor(
    public readonly code: EpisodeStatePlanErrorCode,
    message: string,
    public readonly candidates: readonly EpisodeUnresolvedStateTransition[] = [],
  ) {
    super(message);
    this.name = 'EpisodeStatePlanError';
  }
}

export interface EpisodeStatePanel {
  panelId: string;
  pageNumber: number;
  order: number;
  assignments: readonly PanelEntityAssignment[];
}

export interface EpisodeStateResolvedPanel {
  panelId: string;
  assignments: PanelEntityAssignment[];
}

interface ResolveEpisodeStateAssignmentsBaseInput {
  panels: readonly EpisodeStatePanel[];
  startingStates: readonly EpisodeStartingEntityState[];
  transitions: readonly EpisodeStateTransition[];
}

export type ResolveEpisodeStateAssignmentsInput = ResolveEpisodeStateAssignmentsBaseInput & (
  | {
      policy: Extract<StateAssignmentPolicy, 'preserve_existing'>;
      existingAssignmentsByPanelId: ReadonlyMap<string, readonly PanelEntityAssignment[]>;
    }
  | {
      policy: Extract<StateAssignmentPolicy, 'overwrite_existing'>;
      existingAssignmentsByPanelId?: never;
    }
);

/** Propagates validated story state boundaries through the complete episode in reading order. */
export function resolveEpisodeStateAssignments(
  input: ResolveEpisodeStateAssignmentsInput,
): EpisodeStateResolvedPanel[] {
  if (input.startingStates.length > MAX_EPISODE_STARTING_ENTITY_STATES
    || input.transitions.length > MAX_EPISODE_STATE_TRANSITIONS) {
    throw new EpisodeStatePlanError('LIMIT_EXCEEDED', 'Episode state plan exceeds its limit');
  }

  const orderedPanels = [...input.panels].sort(comparePanels);
  if (input.policy === 'preserve_existing'
    && (!(input.existingAssignmentsByPanelId instanceof Map)
      || input.existingAssignmentsByPanelId.size !== orderedPanels.length
      || orderedPanels.some((panel) => !input.existingAssignmentsByPanelId.has(panel.panelId)))) {
    throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode assignment snapshot is incomplete');
  }
  const panelOrder = new Map<string, number>();
  for (const [index, panel] of orderedPanels.entries()) {
    if (panelOrder.has(panel.panelId)) {
      throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state plan repeats a panel ID');
    }
    panelOrder.set(panel.panelId, index);
  }

  const activeStateByEntity = new Map<string, string | null>();
  for (const startingState of input.startingStates) {
    if (activeStateByEntity.has(startingState.entityId)) {
      throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode start repeats an entity');
    }
    activeStateByEntity.set(startingState.entityId, startingState.stateId);
  }

  const transitionsByPanel = new Map<string, EpisodeStateTransition[]>();
  const boundaryKeys = new Set<string>();
  let previousPosition = -1;
  for (const transition of input.transitions) {
    const position = panelOrder.get(transition.startsAtPanelId);
    if (position === undefined || position < previousPosition) {
      throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state transition has an unknown or out-of-order panel');
    }
    const boundaryKey = `${transition.startsAtPanelId}:${transition.entityId}`;
    if (boundaryKeys.has(boundaryKey)) {
      throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode state transition repeats a boundary');
    }
    boundaryKeys.add(boundaryKey);
    previousPosition = position;
    const atPanel = transitionsByPanel.get(transition.startsAtPanelId) ?? [];
    atPanel.push(transition);
    transitionsByPanel.set(transition.startsAtPanelId, atPanel);
  }

  const resolvedByPanel = new Map<string, EpisodeStateResolvedPanel>();
  for (const panel of orderedPanels) {
    for (const transition of transitionsByPanel.get(panel.panelId) ?? []) {
      activeStateByEntity.set(transition.entityId, transition.stateId);
    }
    const seenEntities = new Set<string>();
    const assignments = panel.assignments.map((assignment) => {
      if (seenEntities.has(assignment.entityId)) {
        throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode panel repeats an entity assignment');
      }
      seenEntities.add(assignment.entityId);
      return {
        ...assignment,
        stateId: activeStateByEntity.get(assignment.entityId) ?? null,
      };
    });
    if (input.policy === 'preserve_existing') {
      validateExistingAssignments(
        panel.panelId,
        assignments,
        input.existingAssignmentsByPanelId.get(panel.panelId) ?? [],
      );
    }
    resolvedByPanel.set(panel.panelId, { panelId: panel.panelId, assignments });
  }

  return input.panels.map((panel) => {
    const result = resolvedByPanel.get(panel.panelId);
    if (result === undefined) {
      throw new EpisodeStatePlanError('STATE_PLAN_INVALID', 'Episode panel is missing from the resolved plan');
    }
    return result;
  });
}

function validateExistingAssignments(
  panelId: string,
  resolved: readonly PanelEntityAssignment[],
  existing: readonly PanelEntityAssignment[],
): void {
  const resolvedByEntity = new Map(resolved.map((assignment) => [assignment.entityId, assignment.stateId] as const));
  for (const assignment of existing) {
    const plannedState = resolvedByEntity.get(assignment.entityId);
    if (plannedState === undefined || plannedState !== assignment.stateId) {
      throw new EpisodeStatePlanError(
        'STATE_ASSIGNMENT_CONFLICT',
        `Existing assignment conflicts with the episode state plan at panel ${panelId}`,
      );
    }
  }
}

function comparePanels(left: EpisodeStatePanel, right: EpisodeStatePanel): number {
  return left.pageNumber - right.pageNumber
    || left.order - right.order
    || left.panelId.localeCompare(right.panelId);
}
