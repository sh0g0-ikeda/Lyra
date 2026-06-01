import { z } from 'zod';

export const pageUuidParamSchema = z.string().uuid();

const styleReferenceSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(2000).nullable().optional(),
    compiled_brief: z.string().max(4000).optional(),
    anchors: z
      .object({
        line_quality: z.string().max(500).nullable().optional(),
        shape_language: z.string().max(500).nullable().optional(),
        face_rendering: z.string().max(500).nullable().optional(),
        eye_rendering: z.string().max(500).nullable().optional(),
        hair_rendering: z.string().max(500).nullable().optional(),
        clothing_rendering: z.string().max(500).nullable().optional(),
        background_rendering: z.string().max(500).nullable().optional(),
        shading_rendering: z.string().max(500).nullable().optional(),
        texture_finish: z.string().max(500).nullable().optional(),
        motion_treatment: z.string().max(500).nullable().optional(),
        dialogue_balloon_treatment: z.string().max(500).nullable().optional(),
        atmosphere: z.string().max(500).nullable().optional(),
      })
      .strict()
      .optional(),
    compiler_provider: z.literal('openai').optional(),
    compiler_model: z.string().max(100).optional(),
    compiler_prompt_version: z.string().max(100).optional(),
    compiled_at: z.string().max(100).optional(),
  })
  .strict();

export const updatePageSettingsBodySchema = z
  .object({
    dialogue_mode: z.enum(['image_baked', 'balloon_only', 'mixed']).optional(),
    page_dialogue_toggle: z.boolean().optional(),
    style_reference: styleReferenceSchema.nullable().optional(),
    story_source_scene_ids: z.array(z.string().uuid()).max(100).optional(),
    story_page_purpose: z.string().trim().min(1).max(500).nullable().optional(),
    story_continuity_note: z.string().trim().min(1).max(1_000).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });
