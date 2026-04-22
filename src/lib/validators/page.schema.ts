import { z } from 'zod';

const layoutTemplateIdSchema = z.enum([
  'standard_4',
  'top_wide_3',
  'standard_6',
  'dense_8',
  'climax_2',
  'splash_1',
  'action_5',
  'battle_7',
]);
const layoutTypeSchema = z.enum(['template', 'custom', 'ai_generated']);
const dialogueModeSchema = z.enum(['image_baked', 'balloon_only', 'mixed']);
const pageStatusSchema = z.enum(['designing', 'generating', 'generated', 'editing', 'confirmed']);
const panelRoleSchema = z.enum(['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact']);
const panelSizeSchema = z.enum(['standard', 'large', 'wide', 'narrow', 'splash']);
const panelEntityRoleSchema = z.enum(['primary', 'secondary', 'background']);
const panelExpressionSchema = z.enum(['determined', 'calm', 'angry', 'sad', 'surprised', 'custom']);
const panelActionSchema = z.enum(['standing_firm', 'attacking', 'defending', 'running', 'custom']);
const panelPositionSchema = z.enum(['left', 'center', 'right', 'background']);
const compositionSourceSchema = z.enum(['gallery', 'custom', 'ai_auto']);
const dialogueTypeSchema = z.enum(['speech', 'thought', 'narration', 'shout', 'whisper', 'sfx']);
const dialoguePositionSchema = z.enum(['top', 'bottom', 'left', 'right', 'center']);
const nullableText100 = z.string().trim().min(1).max(100).nullable();
const nullableText200 = z.string().trim().min(1).max(200).nullable();
const nullableText500 = z.string().trim().min(1).max(500).nullable();
const nullableText1000 = z.string().trim().min(1).max(1000).nullable();
const nullableText2000 = z.string().trim().min(1).max(2000).nullable();
const frameDefinitionsSchema = z.array(z.record(z.string(), z.unknown())).max(50);

export const pageUuidParamSchema = z.string().uuid();

export const pageLayoutConfigBodySchema = z
  .object({
    type: layoutTypeSchema.default('template'),
    template_id: layoutTemplateIdSchema.nullable().optional(),
    panel_count: z.number().int().min(1).max(20).optional(),
    layout_reference_s3_key: z.string().trim().min(1).max(1024).nullable().optional(),
    frame_definitions: frameDefinitionsSchema.optional(),
  })
  .strict();

export const createPageBodySchema = z.object({
  scene_id: z.string().uuid().nullable().optional(),
  page_number: z.number().int().min(1).max(1000),
  layout_config: pageLayoutConfigBodySchema.optional(),
  dialogue_mode: dialogueModeSchema.default('image_baked'),
  page_dialogue_toggle: z.boolean().default(true),
});

export const updatePageBodySchema = z
  .object({
    scene_id: z.string().uuid().nullable().optional(),
    page_number: z.number().int().min(1).max(1000).optional(),
    layout_config: pageLayoutConfigBodySchema.optional(),
    dialogue_mode: dialogueModeSchema.optional(),
    page_dialogue_toggle: z.boolean().optional(),
    status: pageStatusSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

const panelEntityBodySchema = z
  .object({
    entity_id: z.string().uuid(),
    role: panelEntityRoleSchema.default('primary'),
    expression: panelExpressionSchema.default('determined'),
    custom_expression: nullableText200.optional(),
    action: panelActionSchema.default('standing_firm'),
    custom_action: nullableText200.optional(),
    position: panelPositionSchema.default('center'),
    state_id: z.string().uuid().nullable().optional(),
  })
  .strict();

const panelCompositionBodySchema = z
  .object({
    source: compositionSourceSchema.default('ai_auto'),
    gallery_item_id: nullableText200.optional(),
    composition_prompt: nullableText2000.optional(),
    shot_type: nullableText100.optional(),
    angle: nullableText100.optional(),
    custom_note: nullableText1000.optional(),
  })
  .strict();

const panelDialogueBodySchema = z
  .object({
    entity_id: z.string().uuid(),
    text: z.string().trim().min(1).max(500),
    type: dialogueTypeSchema.default('speech'),
    position: dialoguePositionSchema.default('bottom'),
  })
  .strict();

export const createPanelBodySchema = z.object({
  order: z.number().int().min(1).max(100),
  panel_role: panelRoleSchema.default('action'),
  panel_size: panelSizeSchema.default('standard'),
  situation_text: nullableText2000.optional(),
  entities: z.array(panelEntityBodySchema).max(20).optional(),
  composition: panelCompositionBodySchema.optional(),
  dialogue_in_panel: z.boolean().default(true),
  dialogue: z.array(panelDialogueBodySchema).max(20).optional(),
  sfx_text: nullableText500.optional(),
  background_note: nullableText2000.optional(),
  panel_notes: nullableText2000.optional(),
});

export const updatePanelBodySchema = z
  .object({
    order: z.number().int().min(1).max(100).optional(),
    panel_role: panelRoleSchema.optional(),
    panel_size: panelSizeSchema.optional(),
    situation_text: nullableText2000.optional(),
    entities: z.array(panelEntityBodySchema).max(20).optional(),
    composition: panelCompositionBodySchema.optional(),
    dialogue_in_panel: z.boolean().optional(),
    dialogue: z.array(panelDialogueBodySchema).max(20).optional(),
    sfx_text: nullableText500.optional(),
    background_note: nullableText2000.optional(),
    panel_notes: nullableText2000.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });
