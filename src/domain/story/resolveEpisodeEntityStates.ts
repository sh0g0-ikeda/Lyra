export const MAX_EPISODE_STATE_TRANSITIONS = 512;

export interface EpisodeStatePanel { id: string; entityIds: string[]; }
export interface EpisodeState { id: string; entityId: string; confirmed: boolean; }
export interface EpisodeStateTransition { entityId: string; stateId: string | null; startsAtPanelId: string; }
export interface EpisodeStateAssignment { panelId: string; entityId: string; stateId: string | null; }
export interface ResolveEpisodeEntityStatesInput {
  panels: EpisodeStatePanel[];
  startingStates: Array<{ entityId: string; stateId: string | null }>;
  states: EpisodeState[];
  transitions: EpisodeStateTransition[];
  existingAssignments: EpisodeStateAssignment[];
  overwriteExisting: boolean;
}
export interface ResolveEpisodeEntityStatesResult { apply: boolean; assignments: EpisodeStateAssignment[]; blockers: string[]; }

export function resolveEpisodeEntityStates(input: ResolveEpisodeEntityStatesInput): ResolveEpisodeEntityStatesResult {
  const fail = (code: string): ResolveEpisodeEntityStatesResult => ({ apply: false, assignments: [], blockers: [code] });
  if (input.transitions.length > MAX_EPISODE_STATE_TRANSITIONS) return fail('LIMIT_EXCEEDED');
  const panels = new Map(input.panels.map((panel) => [panel.id, panel]));
  const states = new Map(input.states.map((state) => [state.id, state]));
  const current = new Map<string, string | null>();
  for (const start of input.startingStates) {
    if (current.has(start.entityId)) return fail('DUPLICATE_STARTING_STATE');
    if (start.stateId !== null) {
      const state = states.get(start.stateId);
      if (state === undefined || state.entityId !== start.entityId) return fail('STATE_MAPPING_INVALID');
      if (!state.confirmed) return fail('STATE_REFERENCE_REQUIRED');
    }
    current.set(start.entityId, start.stateId);
  }
  for (const assignment of input.existingAssignments) {
    const panel = panels.get(assignment.panelId);
    if (panel === undefined || !panel.entityIds.includes(assignment.entityId)) return fail('UNKNOWN_PANEL_OR_ENTITY');
  }
  const atPanel = new Map<string, EpisodeStateTransition[]>();
  for (const transition of input.transitions) {
    const panel = panels.get(transition.startsAtPanelId);
    if (panel === undefined || !panel.entityIds.includes(transition.entityId)) return fail('UNKNOWN_PANEL_OR_ENTITY');
    if (transition.stateId !== null) {
      const state = states.get(transition.stateId);
      if (state === undefined || state.entityId !== transition.entityId) return fail('STATE_MAPPING_INVALID');
      if (!state.confirmed) return fail('STATE_REFERENCE_REQUIRED');
    }
    const key = `${transition.startsAtPanelId}:${transition.entityId}`;
    if (atPanel.has(key)) return fail('DUPLICATE_TRANSITION_BOUNDARY');
    atPanel.set(key, [transition]);
  }
  const assignments: EpisodeStateAssignment[] = [];
  for (const panel of input.panels) for (const entityId of panel.entityIds) {
    const transition = atPanel.get(`${panel.id}:${entityId}`)?.[0];
    if (transition !== undefined) current.set(entityId, transition.stateId);
    const stateId = current.get(entityId) ?? null;
    const existing = input.existingAssignments.find((item) => item.panelId === panel.id && item.entityId === entityId);
    if (existing !== undefined && existing.stateId !== stateId && !input.overwriteExisting) return fail('STATE_ASSIGNMENT_CONFLICT');
    if (stateId !== null || transition !== undefined || input.overwriteExisting) assignments.push({ panelId: panel.id, entityId, stateId });
  }
  return { apply: true, assignments, blockers: [] };
}
