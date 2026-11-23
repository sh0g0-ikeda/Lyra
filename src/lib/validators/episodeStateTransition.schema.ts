import { z } from 'zod';
import {
  MAX_EPISODE_STATE_SOURCE_QUOTE_CHARS,
  MAX_EPISODE_STATE_TRANSITIONS,
} from '../../domain/constants/storyState.js';
import type { EpisodeStateTransitionPlan } from '../../domain/types/episodeStateTransition.js';

export const episodeStateTransitionSourceFields = [
  'story_full_draft',
  'introduction',
  'middle',
  'climax',
  'ending_hook',
  'scene_location',
  'scene_time',
  'scene_atmosphere',
] as const;

const sourceFieldsSchema = z.object({
  entity_id: z.string().uuid(),
  starts_at_panel_id: z.string().uuid(),
  source_scene_id: z.string().uuid().nullable(),
  source_field: z.enum(episodeStateTransitionSourceFields),
  source_quote: z.string().trim().min(1).max(MAX_EPISODE_STATE_SOURCE_QUOTE_CHARS),
  panel_evidence_quote: z.string().trim().min(1).max(2_000).optional(),
}).strict();

const transitionSchema = sourceFieldsSchema.extend({
  state_id: z.string().uuid().nullable(),
}).strict();

const unresolvedSchema = sourceFieldsSchema.extend({
  candidate_state_id: z.string().uuid().nullable(),
  suggested_name: z.string().trim().min(1).max(100),
  suggested_description: z.string().trim().min(1).max(2_000),
  reason: z.enum(['missing_reference', 'ambiguous_mapping']),
  replaces_deltas: z.array(
    z.object({
      source_quote: z.string().trim().min(1).max(MAX_EPISODE_STATE_SOURCE_QUOTE_CHARS),
      description: z.string().trim().min(1).max(2_000),
    }).strict(),
  ).max(MAX_EPISODE_STATE_TRANSITIONS).optional(),
}).strict();

export const episodeStateTransitionPlanSchema = z.object({
  plan_version: z.literal('episode_state_plan_v1'),
  state_transitions: z.array(transitionSchema).max(MAX_EPISODE_STATE_TRANSITIONS),
  unresolved_state_transitions: z.array(unresolvedSchema).max(MAX_EPISODE_STATE_TRANSITIONS),
}).strict().refine((plan) =>
  plan.state_transitions.length + plan.unresolved_state_transitions.length
    <= MAX_EPISODE_STATE_TRANSITIONS,
{ message: 'Episode state plan exceeds its total event limit' });

export type EpisodeStateTransitionPlanPayload = z.infer<typeof episodeStateTransitionPlanSchema>;

export function toEpisodeStateTransitionPlan(
  payload: EpisodeStateTransitionPlanPayload,
): EpisodeStateTransitionPlan {
  return {
    transitions: payload.state_transitions.map((entry) => ({
      entityId: entry.entity_id,
      stateId: entry.state_id,
      startsAtPanelId: entry.starts_at_panel_id,
      sourceSceneId: entry.source_scene_id,
      sourceField: entry.source_field,
      sourceQuote: entry.source_quote,
      ...(entry.panel_evidence_quote === undefined
        ? {}
        : { panelEvidenceQuote: entry.panel_evidence_quote }),
    })),
    unresolved: payload.unresolved_state_transitions.map((entry) => ({
      entityId: entry.entity_id,
      candidateStateId: entry.candidate_state_id,
      startsAtPanelId: entry.starts_at_panel_id,
      suggestedName: entry.suggested_name,
      suggestedDescription: entry.suggested_description,
      sourceSceneId: entry.source_scene_id,
      sourceField: entry.source_field,
      sourceQuote: entry.source_quote,
      ...(entry.panel_evidence_quote === undefined
        ? {}
        : { panelEvidenceQuote: entry.panel_evidence_quote }),
      ...(entry.replaces_deltas === undefined
        ? {}
        : {
            replacesDeltas: entry.replaces_deltas.map((delta) => ({
              sourceQuote: delta.source_quote,
              description: delta.description,
            })),
          }),
      reason: entry.reason,
    })),
  };
}
