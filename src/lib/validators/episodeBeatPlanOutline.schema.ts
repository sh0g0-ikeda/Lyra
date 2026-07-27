import { z } from 'zod';
import {
  EPISODE_BEAT_PLAN_TEXT_LIMITS,
  STORY_AI_LIMITS,
} from '../../domain/constants/storyAi.js';

const limits = EPISODE_BEAT_PLAN_TEXT_LIMITS;

const episodeBeatPlanOutlinePageSchema = z
  .object({
    page_id: z.string().uuid(),
    page_number: z.number().int().min(1).max(10_000),
    story_anchor: z.string().trim().min(1).max(limits.storyBeatChars),
    reserved_transition: z.string().trim().min(1).max(limits.handoffChars),
  })
  .strict();

export const episodeBeatPlanOutlineSchema = z
  .object({
    pages: z
      .array(episodeBeatPlanOutlinePageSchema)
      .min(1)
      .max(STORY_AI_LIMITS.maxSkeletonPages),
  })
  .strict();

export type EpisodeBeatPlanOutlinePayload = z.infer<typeof episodeBeatPlanOutlineSchema>;
