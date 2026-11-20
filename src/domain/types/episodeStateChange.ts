import type { EpisodeStateDeltaReference, EpisodeStateTransitionSourceField } from './episodeStateTransition.js';

/** A saved draft and its final-panel provenance; never an image-reference assignment. */
export interface PersistedEpisodeStateChange {
  entityId: string;
  stateId: string;
  startsAtPanelId: string;
  sourceSceneId: string | null;
  sourceField: EpisodeStateTransitionSourceField;
  sourceQuote: string;
  description: string;
  panelEvidenceQuote?: string;
  replacesDeltas?: readonly EpisodeStateDeltaReference[];
  created: boolean;
}
