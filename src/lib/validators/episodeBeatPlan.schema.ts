import { z } from 'zod';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';

const episodeBeatPlanPageSchema = z
  .object({
    page_id: z.string().uuid(),
    page_number: z.number().int().min(1).max(10_000),
    story_beats: z
      .array(z.string().trim().min(1).max(300))
      .min(1)
      .max(STORY_AI_LIMITS.maxPanelsPerPage),
    entry_state: z.string().trim().min(1).max(600),
    exit_state: z.string().trim().min(1).max(600),
    new_information: z
      .array(z.string().trim().min(1).max(300))
      .max(STORY_AI_LIMITS.maxPanelsPerPage),
    dialogue_intent: z.string().trim().min(1).max(600).nullable(),
    handoff: z.string().trim().min(1).max(600).nullable(),
  })
  .strict();

export const episodeBeatPlanSchema = z
  .object({
    pages: z.array(episodeBeatPlanPageSchema).min(1).max(STORY_AI_LIMITS.maxSkeletonPages),
  })
  .strict();

export type EpisodeBeatPlanPayload = z.infer<typeof episodeBeatPlanSchema>;
