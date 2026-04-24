import { z } from 'zod';
import { PANEL_FRAME_TEMPLATE_IDS } from '../../domain/constants/panelFrameTemplates.js';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';

const nullableText = (maxLength: number): z.ZodNullable<z.ZodString> =>
  z.string().trim().min(1).max(maxLength).nullable();

const boundedStringArray = z
  .array(z.string().trim().min(1).max(STORY_AI_LIMITS.listEntryMaxLength))
  .max(STORY_AI_LIMITS.listMaxItems);

const collaborationContextSchema = z
  .object({
    current_draft: nullableText(STORY_AI_LIMITS.currentDraftMaxLength).optional().default(null),
    selected_text: nullableText(STORY_AI_LIMITS.selectedTextMaxLength).optional().default(null),
    user_notes: nullableText(STORY_AI_LIMITS.notesMaxLength).optional().default(null),
    focus_points: boundedStringArray.optional().default([]),
    constraints: boundedStringArray.optional().default([]),
  })
  .strict();

export const collaborateStoryBodySchema = z
  .object({
    layer: z.enum(['work', 'chapter', 'episode']),
    target_id: z.string().uuid(),
    instruction: z.string().trim().min(1).max(STORY_AI_LIMITS.instructionMaxLength),
    context: collaborationContextSchema.optional().default({
      current_draft: null,
      selected_text: null,
      user_notes: null,
      focus_points: [],
      constraints: [],
    }),
  })
  .strict();

export const generatePageSkeletonParamSchema = z.string().uuid();

const pageSkeletonPanelSchema = z
  .object({
    order: z.number().int().min(1).max(STORY_AI_LIMITS.maxPanelsPerPage),
    panel_role: z.enum(['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact']),
    suggested_size: z.enum(['standard', 'large', 'wide', 'narrow', 'splash']),
    situation_hint: z.string().trim().min(1).max(2000),
    suggested_entities: z.array(z.string().uuid()).max(STORY_AI_LIMITS.maxEntitiesPerPanel),
    suggested_dialogue_hint: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict();

const pageSkeletonPageSchema = z
  .object({
    page_number: z.number().int().min(1).max(STORY_AI_LIMITS.maxSkeletonPages),
    purpose: z.string().trim().min(1).max(500),
    suggested_panel_count: z.number().int().min(1).max(STORY_AI_LIMITS.maxPanelsPerPage),
    suggested_layout: z.enum(PANEL_FRAME_TEMPLATE_IDS),
    panels: z.array(pageSkeletonPanelSchema).min(1).max(STORY_AI_LIMITS.maxPanelsPerPage),
  })
  .strict();

export const pageSkeletonResponseSchema = z
  .object({
    pages: z.array(pageSkeletonPageSchema).min(1).max(STORY_AI_LIMITS.maxSkeletonPages),
  })
  .strict();
