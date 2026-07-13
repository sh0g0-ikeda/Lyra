import { z } from 'zod';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';

export const episodePlanAuditIssueCodes = [
  'duplicate_dialogue',
  'duplicate_visual_beat',
  'timeline_discontinuity',
  'dialogue_misplacement',
  'knowledge_violation',
  'page_handoff_break',
  'unsupported_story_fact',
] as const;

const episodePlanAuditIssueSchema = z
  .object({
    code: z.enum(episodePlanAuditIssueCodes),
    severity: z.enum(['warning', 'error']),
    page_ids: z.array(z.string().uuid()).min(1).max(STORY_AI_LIMITS.maxSkeletonPages),
    message: z.string().trim().min(1).max(1_000),
    repair_instruction: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const episodePlanAuditSchema = z
  .object({
    accepted: z.boolean(),
    issues: z.array(episodePlanAuditIssueSchema).max(STORY_AI_LIMITS.maxSkeletonPages * 4),
  })
  .strict();

export type EpisodePlanAuditPayload = z.infer<typeof episodePlanAuditSchema>;
