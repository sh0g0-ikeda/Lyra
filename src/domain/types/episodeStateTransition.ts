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
}

export type StateAssignmentPolicy = 'preserve_existing' | 'overwrite_existing';

export interface EpisodeUnresolvedStateTransition {
  entityId: string;
  candidateStateId: string | null;
  startsAtPanelId: string;
  suggestedName: string;
  suggestedDescription: string;
  sourceSceneId: string | null;
  sourceField: EpisodeStateTransitionSourceField;
  sourceQuote: string;
  reason: 'missing_reference' | 'ambiguous_mapping';
}

export interface EpisodeStateTransitionPlan {
  transitions: EpisodeStateTransition[];
  unresolved: EpisodeUnresolvedStateTransition[];
}
