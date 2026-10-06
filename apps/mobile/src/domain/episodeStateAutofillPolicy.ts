import { z } from 'zod';
import { episodeStateBlockerSchema, episodeStateTransitionResultSchema } from '@/domain/apiSchemas';

export interface EpisodeStateAutofillChoice {
  enabled: boolean;
  overwrite: boolean;
}
export interface EpisodeStateAutofillRequestOptions {
  state_autofill_version: 'v1';
  state_assignment_policy: 'preserve_existing' | 'overwrite_existing';
}

export function stateAutofillRequestOptions(
  available: boolean,
  choice: EpisodeStateAutofillChoice
): EpisodeStateAutofillRequestOptions | undefined {
  if (!available || !choice.enabled) return undefined;
  return { state_autofill_version: 'v1', state_assignment_policy: choice.overwrite ? 'overwrite_existing' : 'preserve_existing' };
}

// Reuse the canonical bounded public job-result schemas. Legacy jobs omit these
// fields; malformed/unknown provider material is never displayed.
// The general mobile contract tolerates legacy opaque strings for IDs. Recovery
// navigation is stricter: never use an unverified identifier as an entity target.
const uuid = z.string().uuid();
const sourceIds = { entity_id: uuid, starts_at_panel_id: uuid, source_scene_id: uuid.nullable() };
const blockerSchema = episodeStateBlockerSchema.extend({
  candidates: z.array(episodeStateBlockerSchema.shape.candidates.element.extend({
    ...sourceIds, candidate_state_id: uuid.nullable()
  })).max(20)
});
const transitionsSchema = z.array(episodeStateTransitionResultSchema.extend({
  ...sourceIds, state_id: uuid.nullable()
})).max(512);
export type EpisodeStateBlocker = z.infer<typeof blockerSchema>;
export type EpisodeStateTransition = z.infer<typeof transitionsSchema>[number];

export function readEpisodeStateResult(result: Record<string, unknown> | null): { blocker: EpisodeStateBlocker | null; transitions: EpisodeStateTransition[] } {
  const blocker = blockerSchema.safeParse(result?.state_blocker);
  const transitions = transitionsSchema.safeParse(result?.state_transitions);
  return { blocker: blocker.success ? blocker.data : null, transitions: transitions.success ? transitions.data : [] };
}
