export interface EpisodeStartingEntityState {
  entityId: string;
  stateId: string | null;
}

export type EpisodeStateTransitionSourceField =
  | 'story_full_draft'
  | 'introduction'
  | 'middle'
  | 'climax'
  | 'ending_hook'
  | 'scene_location'
  | 'scene_time'
  | 'scene_atmosphere';

export interface EpisodeStateTransition {
  entityId: string;
  stateId: string | null;
  startsAtPanelId: string;
  sourceSceneId: string | null;
  sourceField: EpisodeStateTransitionSourceField;
  sourceQuote: string;
  /** Required only for final-draft automatic extraction; legacy plans may omit it. */
  panelEvidenceQuote?: string;
}

export type StateAssignmentPolicy = 'preserve_existing' | 'overwrite_existing';

export interface EpisodeStateDeltaReference {
  sourceQuote: string;
  description: string;
}

export interface EpisodeUnresolvedStateTransition {
  entityId: string;
  candidateStateId: string | null;
  startsAtPanelId: string;
  suggestedName: string;
  suggestedDescription: string;
  sourceSceneId: string | null;
  sourceField: EpisodeStateTransitionSourceField;
  sourceQuote: string;
  /** Literal evidence from the completed onset panel in final-draft automatic mode. */
  panelEvidenceQuote?: string;
  /** Final-draft mode only: exact prior literal deltas replaced by this delta. */
  replacesDeltas?: readonly EpisodeStateDeltaReference[];
  reason: 'missing_reference' | 'ambiguous_mapping';
}

export interface EpisodeStateTransitionPlan {
  transitions: EpisodeStateTransition[];
  unresolved: EpisodeUnresolvedStateTransition[];
}
