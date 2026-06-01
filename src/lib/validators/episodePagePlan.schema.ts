import { z } from 'zod';
import { autofillPanelSuggestionSchema } from './pageAutofill.schema.js';

const episodePagePlanPageSchema = z
  .object({
    page_id: z.string().uuid(),
    page_number: z.number().int().min(1).max(10_000),
    source_scene_ids: z.array(z.string().uuid()).max(100).optional().default([]),
    page_purpose: z.string().trim().min(1).max(500).nullable().optional().default(null),
    continuity_note: z.string().trim().min(1).max(1_000).nullable().optional().default(null),
    page: z
      .object({
        dialogue_mode: z.enum(['image_baked', 'balloon_only', 'mixed']).optional(),
        page_dialogue_toggle: z.boolean().optional(),
      })
      .strict()
      .optional(),
    panels: z.array(autofillPanelSuggestionSchema).min(1).max(20),
  })
  .strict();

export const episodePagePlanSuggestionSchema = z
  .object({
    pages: z.array(episodePagePlanPageSchema).min(1).max(200),
  })
  .strict();

export type EpisodePagePlanSuggestionPayload = z.infer<typeof episodePagePlanSuggestionSchema>;
