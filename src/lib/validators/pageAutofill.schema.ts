import { z } from 'zod';

const nullableText200 = z.string().trim().min(1).max(200).nullable();
const nullableText500 = z.string().trim().min(1).max(500).nullable();
const nullableText1000 = z.string().trim().min(1).max(1000).nullable();
const nullableText2000 = z.string().trim().min(1).max(2000).nullable();

export const autofillDialogueLineSchema = z
  .object({
    entity_id: z.string().uuid().nullable().optional().default(null),
    text: z.string().trim().min(1).max(500),
    type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper']),
    position: z.enum(['top', 'bottom', 'left', 'right', 'center']),
  })
  .strict();

export const autofillPanelEntityAssignmentSchema = z
  .object({
    entity_id: z.string().uuid(),
    role: z.enum(['primary', 'secondary', 'background']),
    expression: z.enum(['determined', 'calm', 'angry', 'sad', 'surprised', 'custom']),
    custom_expression: nullableText200.optional().default(null),
    action: z.enum(['standing_firm', 'attacking', 'defending', 'running', 'custom']),
    custom_action: nullableText200.optional().default(null),
    position: z.enum(['left', 'center', 'right', 'background']),
    facing_direction: z
      .enum(['front', 'left', 'right', 'away', 'three_quarter_left', 'three_quarter_right'])
      .nullable()
      .optional()
      .default(null),
    effect_note: nullableText500.optional().default(null),
    state_id: z.string().uuid().nullable().optional().default(null),
  })
  .strict();

export const autofillCompositionSchema = z
  .object({
    source: z.enum(['gallery', 'custom', 'ai_auto']).optional(),
    gallery_item_id: z.string().trim().min(1).max(100).nullable().optional().default(null),
    composition_prompt: nullableText1000.optional().default(null),
    shot_type: z
      .enum(['full_body', 'half_body', 'close_up', 'wide', 'extreme_close_up'])
      .nullable()
      .optional()
      .default(null),
    angle: z
      .enum(['front', 'side', 'three_quarter', 'bird_eye', 'worm_eye', 'dutch_angle'])
      .nullable()
      .optional()
      .default(null),
    custom_note: nullableText1000.optional().default(null),
  })
  .strict();

export const autofillPanelSuggestionSchema = z
  .object({
    order: z.number().int().min(1).max(1000),
    panel_role: z
      .enum(['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact'])
      .optional(),
    panel_size: z.enum(['standard', 'large', 'wide', 'narrow', 'splash']).optional(),
    situation_text: nullableText2000.optional(),
    composition: autofillCompositionSchema.optional(),
    dialogue_in_panel: z.boolean().optional(),
    dialogue: z.array(autofillDialogueLineSchema).max(20).optional(),
    sfx_text: nullableText200.optional(),
    background_note: nullableText2000.optional(),
    panel_notes: nullableText2000.optional(),
    entities: z.array(autofillPanelEntityAssignmentSchema).max(20).optional(),
  })
  .strict();

export const pageAutofillSuggestionSchema = z
  .object({
    page: z
      .object({
        dialogue_mode: z.enum(['image_baked', 'balloon_only', 'mixed']).optional(),
        page_dialogue_toggle: z.boolean().optional(),
      })
      .strict()
      .optional(),
    panels: z.array(autofillPanelSuggestionSchema).max(20),
  })
  .strict();

export type PageAutofillSuggestionPayload = z.infer<typeof pageAutofillSuggestionSchema>;
