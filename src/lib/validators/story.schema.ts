import { z } from 'zod';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';

const text200 = z.string().trim().min(1).max(200);
const nullableText200 = z.string().trim().min(1).max(200).nullable();
const nullableText2000 = z.string().trim().min(1).max(2000).nullable();
const nullableText8000 = z.string().trim().min(1).max(8000).nullable();
const uuidArray = z.array(z.string().uuid()).max(100);
const keyBeatsArray = z.array(z.string().trim().min(1).max(500)).max(50);
const statusSchema = z.enum(['draft', 'reviewing', 'ready']);
const episodeStoryInputModeSchema = z.enum(['structured', 'full']);
const storyItemMoveDirectionSchema = z.enum(['up', 'down']);

export const storyUuidParamSchema = z.string().uuid();

export const createWorkBodySchema = z
  .object({
    title: text200,
    genre: nullableText200.optional(),
    world_setting: nullableText2000.optional(),
    theme: nullableText2000.optional(),
    main_entity_ids: uuidArray.optional(),
    starting_point: nullableText2000.optional(),
    ending_point: nullableText2000.optional(),
    overall_flow: nullableText2000.optional(),
  })
  .strict();

export const updateWorkBodySchema = z
  .object({
    title: text200.optional(),
    genre: nullableText200.optional(),
    world_setting: nullableText2000.optional(),
    theme: nullableText2000.optional(),
    main_entity_ids: uuidArray.optional(),
    starting_point: nullableText2000.optional(),
    ending_point: nullableText2000.optional(),
    overall_flow: nullableText2000.optional(),
    status: statusSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

export const createChapterBodySchema = z
  .object({
    order: z.number().int().min(1).max(1000),
    title: nullableText200.optional(),
    purpose: nullableText2000.optional(),
    starting_state: nullableText2000.optional(),
    ending_state: nullableText2000.optional(),
    emotion_curve: nullableText2000.optional(),
    entities_involved: uuidArray.optional(),
    key_beats: keyBeatsArray.optional(),
  })
  .strict();

export const updateChapterBodySchema = z
  .object({
    order: z.number().int().min(1).max(1000).optional(),
    title: nullableText200.optional(),
    purpose: nullableText2000.optional(),
    starting_state: nullableText2000.optional(),
    ending_state: nullableText2000.optional(),
    emotion_curve: nullableText2000.optional(),
    entities_involved: uuidArray.optional(),
    key_beats: keyBeatsArray.optional(),
    status: statusSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

export const createEpisodeBodySchema = z
  .object({
    order: z.number().int().min(1).max(1000),
    title: nullableText200.optional(),
    purpose: nullableText2000.optional(),
    story_input_mode: episodeStoryInputModeSchema.optional().default('structured'),
    story_full_draft: nullableText8000.optional(),
    introduction: nullableText2000.optional(),
    middle: nullableText2000.optional(),
    climax: nullableText2000.optional(),
    ending_hook: nullableText2000.optional(),
    estimated_pages: z.number().int().min(1).max(STORY_AI_LIMITS.maxSkeletonPages).default(16),
    entities_involved: uuidArray.optional(),
  })
  .strict();

export const updateEpisodeBodySchema = z
  .object({
    order: z.number().int().min(1).max(1000).optional(),
    title: nullableText200.optional(),
    purpose: nullableText2000.optional(),
    story_input_mode: episodeStoryInputModeSchema.optional(),
    story_full_draft: nullableText8000.optional(),
    introduction: nullableText2000.optional(),
    middle: nullableText2000.optional(),
    climax: nullableText2000.optional(),
    ending_hook: nullableText2000.optional(),
    estimated_pages: z.number().int().min(1).max(STORY_AI_LIMITS.maxSkeletonPages).optional(),
    entities_involved: uuidArray.optional(),
    status: statusSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

export const moveStoryItemBodySchema = z
  .object({
    direction: storyItemMoveDirectionSchema,
  })
  .strict();
