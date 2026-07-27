import { z } from 'zod';
import {
  EPISODE_BEAT_PLAN_TEXT_LIMITS,
  STORY_AI_LIMITS,
} from '../../domain/constants/storyAi.js';

const limits = EPISODE_BEAT_PLAN_TEXT_LIMITS;

const episodeBeatPlanPageSchema = z
  .object({
    page_id: z.string().uuid(),
    page_number: z.number().int().min(1).max(10_000),
    story_beats: z
      .array(z.string().trim().min(1).max(limits.storyBeatChars))
      .min(1)
      .max(STORY_AI_LIMITS.maxPanelsPerPage),
    entry_state: z.string().trim().min(1).max(limits.entryExitChars),
    exit_state: z.string().trim().min(1).max(limits.entryExitChars),
    new_information: z
      .array(z.string().trim().min(1).max(limits.newInformationChars))
      .max(limits.maxNewInformationItems),
    dialogue_intent: z.string().trim().min(1).max(limits.dialogueIntentChars).nullable(),
    handoff: z.string().trim().min(1).max(limits.handoffChars).nullable(),
  })
  .strict();

export const episodeBeatPlanSchema = z
  .object({
    pages: z.array(episodeBeatPlanPageSchema).min(1).max(8),
  })
  .strict();

export type EpisodeBeatPlanPayload = z.infer<typeof episodeBeatPlanSchema>;
