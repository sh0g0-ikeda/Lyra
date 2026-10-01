import type { UpdateEpisodePayload } from '@/domain/payloads';

export type EpisodeStartingState = NonNullable<UpdateEpisodePayload['starting_entity_states']>[number];
export const MAX_EPISODE_STARTING_STATES = 100;

// Undefined means the control was never edited: do not add an API field. An
// explicit [] is a user-requested reset; null within a row is explicit default.
export function startingStateSavePatch(
  draft: readonly EpisodeStartingState[] | undefined
): Pick<UpdateEpisodePayload, 'starting_entity_states'> {
  return draft === undefined ? {} : { starting_entity_states: draft.map((state) => ({ ...state })) };
}

export function startingStateDraftIsDirty(
  saved: readonly EpisodeStartingState[] | undefined,
  draft: readonly EpisodeStartingState[] | undefined
): boolean {
  return draft !== undefined && (saved === undefined || JSON.stringify(saved) !== JSON.stringify(draft));
}

export function addStartingEntityState(
  value: EpisodeStartingState[],
  entityId: string
): EpisodeStartingState[] {
  if (value.length >= MAX_EPISODE_STARTING_STATES || value.some((state) => state.entity_id === entityId)) return value;
  return [...value, { entity_id: entityId, state_id: null }];
}
