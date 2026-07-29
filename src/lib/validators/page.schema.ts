import { z } from 'zod';
import { PANEL_FRAME_TEMPLATE_IDS } from '../../domain/constants/panelFrameTemplates.js';
import { APP_LANGUAGES } from '../../domain/types/language.js';

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

export const applyPageLayoutTemplateBodySchema = z
  .object({
    template_id: z.enum(PANEL_FRAME_TEMPLATE_IDS),
    allow_panel_truncation: z.literal(false).optional().default(false),
  })
  .strict();

const nullableText200 = z.string().trim().min(1).max(200).nullable();
const nullableText1000 = z.string().trim().min(1).max(1_000).nullable();
const nullableText2000 = z.string().trim().min(1).max(2_000).nullable();

const saveAndGenerateAssignmentSchema = z
  .object({
    entity_id: z.string().uuid(),
    role: z.enum(['primary', 'secondary', 'background']),
    expression: z.enum(['determined', 'calm', 'angry', 'sad', 'surprised', 'custom']),
    custom_expression: z.string().trim().min(1).max(100).nullable().optional().default(null),
    action: z.enum(['standing_firm', 'attacking', 'defending', 'running', 'custom']),
    custom_action: z.string().trim().min(1).max(100).nullable().optional().default(null),
    position: z.enum(['left', 'center', 'right', 'background']),
    facing_direction: z
      .enum(['front', 'left', 'right', 'away', 'three_quarter_left', 'three_quarter_right'])
      .nullable()
      .optional()
      .default(null),
    effect_note: z.string().trim().min(1).max(200).nullable().optional().default(null),
    state_id: z.string().uuid().nullable().optional().default(null),
  })
  .strict()
  .superRefine((assignment, context) => {
    if (assignment.expression === 'custom' && assignment.custom_expression === null) {
      context.addIssue({ code: 'custom', message: 'custom_expression is required when expression is custom' });
    }
    if (assignment.action === 'custom' && assignment.custom_action === null) {
      context.addIssue({ code: 'custom', message: 'custom_action is required when action is custom' });
    }
  });

const saveAndGeneratePanelSchema = z
  .object({
    id: z.string().uuid(),
    order: z.number().int().min(1).max(20),
    panel_role: z
      .enum(['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact'])
      .optional()
      .default('action'),
    panel_size: z.enum(['standard', 'large', 'wide', 'narrow', 'splash']).optional().default('standard'),
    situation_text: nullableText2000.optional().default(null),
    composition: z
      .object({
        source: z.enum(['gallery', 'custom', 'ai_auto']).default('custom'),
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
      .optional()
      .default({
        source: 'custom',
        gallery_item_id: null,
        composition_prompt: null,
        shot_type: null,
        angle: null,
        custom_note: null,
      }),
    dialogue_in_panel: z.boolean().optional().default(true),
    dialogue: z
      .array(
        z
          .object({
            entity_id: z.string().uuid().nullable().optional().default(null),
            text: z.string().trim().min(1).max(500),
            type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper', 'sfx']),
            position: z.enum(['top', 'bottom', 'left', 'right', 'center']),
          })
          .strict(),
      )
      .max(20)
      .optional()
      .default([]),
    sfx_text: nullableText200.optional().default(null),
    background_note: nullableText2000.optional().default(null),
    panel_notes: nullableText2000.optional().default(null),
    entities: z.array(saveAndGenerateAssignmentSchema).max(20),
  })
  .strict()
  .superRefine((panel, context) => {
    if (panel.composition.source === 'gallery' && panel.composition.gallery_item_id === null) {
      context.addIssue({
        code: 'custom',
        message: 'gallery_item_id is required when source is gallery',
        path: ['composition', 'gallery_item_id'],
      });
    }
    const entityIds = new Set<string>();
    panel.entities.forEach((assignment, index) => {
      if (entityIds.has(assignment.entity_id)) {
        context.addIssue({
          code: 'custom',
          message: 'entity_id must be unique within entities',
          path: ['entities', index, 'entity_id'],
        });
      }
      entityIds.add(assignment.entity_id);
    });
  });

const saveAndGenerateFrameSchema = z
  .object({
    panel_id: z.string().uuid(),
    vertices: z
      .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict())
      .length(4),
    border_style: z.enum(['solid', 'dashed', 'none']).default('solid'),
    border_width: z.number().int().min(0).max(20).default(3),
    border_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#000000'),
    z_index: z.number().int().min(0).max(1_000).default(1),
    reading_order: z.number().int().min(1).max(20),
  })
  .strict();

export const saveAndGeneratePageBodySchema = z
  .object({
    expected_updated_at: z.string().datetime({ offset: true }),
    page: z
      .object({
        dialogue_mode: z.enum(['image_baked', 'balloon_only', 'mixed']).optional(),
        page_dialogue_toggle: z.boolean().optional(),
        style_reference: styleReferenceSchema.nullable().optional(),
        story_source_scene_ids: z.array(z.string().uuid()).max(100).optional(),
        story_page_purpose: z.string().trim().min(1).max(500).nullable().optional(),
        story_continuity_note: z.string().trim().min(1).max(1_000).nullable().optional(),
      })
      .strict()
      .default({}),
    panels: z.array(saveAndGeneratePanelSchema).min(1).max(20),
    frames: z.array(saveAndGenerateFrameSchema).min(1).max(20),
    generation: z.object({ language: z.enum(APP_LANGUAGES) }).strict(),
  })
  .strict()
  .superRefine((body, context) => {
    const panelIds = new Set<string>();
    const panelOrders = new Set<number>();
    body.panels.forEach((panel, index) => {
      if (panelIds.has(panel.id)) {
        context.addIssue({ code: 'custom', message: 'panel id must be unique', path: ['panels', index, 'id'] });
      }
      panelIds.add(panel.id);
      if (panelOrders.has(panel.order)) {
        context.addIssue({ code: 'custom', message: 'panel order must be unique', path: ['panels', index, 'order'] });
      }
      panelOrders.add(panel.order);
    });

    const readingOrders = new Set<number>();
    const framePanelIds = new Set<string>();
    body.frames.forEach((frame, index) => {
      if (!panelIds.has(frame.panel_id)) {
        context.addIssue({ code: 'custom', message: 'frame panel_id must be present in panels', path: ['frames', index, 'panel_id'] });
      }
      if (readingOrders.has(frame.reading_order)) {
        context.addIssue({ code: 'custom', message: 'frame reading_order must be unique', path: ['frames', index, 'reading_order'] });
      }
      readingOrders.add(frame.reading_order);
      if (framePanelIds.has(frame.panel_id)) {
        context.addIssue({ code: 'custom', message: 'frame panel_id must be unique', path: ['frames', index, 'panel_id'] });
      }
      framePanelIds.add(frame.panel_id);
    });
    panelIds.forEach((panelId) => {
      if (!framePanelIds.has(panelId)) {
        context.addIssue({ code: 'custom', message: 'every panel requires one frame', path: ['frames'] });
      }
    });
  });
