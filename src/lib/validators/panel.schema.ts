import { z } from 'zod';

const nullableText200 = z.string().trim().min(1).max(200).nullable();
const nullableText1000 = z.string().trim().min(1).max(1000).nullable();
const nullableText2000 = z.string().trim().min(1).max(2000).nullable();

const panelCompositionSchema = z
  .object({
    source: z.enum(['gallery', 'custom', 'ai_auto']),
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
  .strict()
  .superRefine((composition, context) => {
    if (composition.source === 'gallery' && composition.gallery_item_id === null) {
      context.addIssue({
        code: 'custom',
        message: 'gallery_item_id is required when source is gallery',
        path: ['gallery_item_id'],
      });
    }
  });

const panelDialogueLineSchema = z
  .object({
    entity_id: z.string().uuid().nullable().optional().default(null),
    text: z.string().trim().min(1).max(500),
    type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper', 'sfx']),
    position: z.enum(['top', 'bottom', 'left', 'right', 'center']),
  })
  .strict()
  .superRefine((line, context) => {
    if (requiresSpeaker(line.type) && line.entity_id === null) {
      context.addIssue({
        code: 'custom',
        message: 'entity_id is required for speaker dialogue types',
        path: ['entity_id'],
      });
    }
  });

export const panelUuidParamSchema = z.string().uuid();

export const createPanelBodySchema = z.object({
  order: z.number().int().min(1).max(1000),
  panel_role: z
    .enum(['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact'])
    .optional()
    .default('action'),
  panel_size: z.enum(['standard', 'large', 'wide', 'narrow', 'splash']).optional().default('standard'),
  situation_text: nullableText2000.optional(),
  composition: panelCompositionSchema.optional().default({
    source: 'custom',
    gallery_item_id: null,
    composition_prompt: null,
    shot_type: null,
    angle: null,
    custom_note: null,
  }),
  dialogue_in_panel: z.boolean().optional().default(true),
  dialogue: z.array(panelDialogueLineSchema).max(20).optional().default([]),
  sfx_text: nullableText200.optional(),
  background_note: nullableText2000.optional(),
  panel_notes: nullableText2000.optional(),
});

export const updatePanelBodySchema = z
  .object({
    order: z.number().int().min(1).max(1000).optional(),
    panel_role: z
      .enum(['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact'])
      .optional(),
    panel_size: z.enum(['standard', 'large', 'wide', 'narrow', 'splash']).optional(),
    situation_text: nullableText2000.optional(),
    composition: panelCompositionSchema.optional(),
    dialogue_in_panel: z.boolean().optional(),
    dialogue: z.array(panelDialogueLineSchema).max(20).optional(),
    sfx_text: nullableText200.optional(),
    background_note: nullableText2000.optional(),
    panel_notes: nullableText2000.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

function requiresSpeaker(type: z.infer<typeof panelDialogueLineSchema>['type']): boolean {
  return type === 'speech' || type === 'thought' || type === 'shout' || type === 'whisper';
}
