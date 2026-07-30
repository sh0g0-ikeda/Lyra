import { z } from 'zod';

const idSchema = z.string().min(1);
const nullableStringSchema = z.string().nullable();
const timestampSchema = z.string().min(1);
const storyStatusSchema = z.enum(['draft', 'reviewing', 'ready']);
const organizationRoleSchema = z.enum(['owner', 'admin', 'billing', 'editor', 'viewer']);
const organizationStatusSchema = z.enum([
  'active',
  'trialing',
  'past_due',
  'suspended',
  'canceled',
]);
const organizationPlanSchema = z.enum(['enterprise_a', 'enterprise_b', 'enterprise_c']);
const organizationMembershipStatusSchema = z.enum([
  'invited',
  'active',
  'suspended',
  'removed',
]);

const creditBalanceSchema = z.object({
  monthly_credits: z.number().int().nonnegative(),
  purchased_credits: z.number().int().nonnegative(),
  total_credits: z.number().int().nonnegative(),
  monthly_expires_at: nullableStringSchema,
});

const subscriptionPlanSchema = z.object({
  plan_code: z.enum(['standard', 'premium', 'enterprise_a', 'enterprise_b', 'enterprise_c']),
  display_name_ja: z.string(),
  display_name_en: z.string(),
  monthly_credits: z.number().int().nonnegative(),
  amount_jpy: z.number().int().nonnegative(),
  minimum_contract_months: z.number().int().nonnegative(),
  trial_days: z.number().int().nonnegative(),
  is_enterprise: z.boolean(),
  configured: z.boolean(),
});

export const billingBalanceSchema = z.object({
  monthly_credits: z.number().int().nonnegative(),
  purchased_credits: z.number().int().nonnegative(),
  total_credits: z.number().int().nonnegative(),
  monthly_expires_at: nullableStringSchema,
  plan_code: z.enum(['free', 'standard', 'premium', 'enterprise_a', 'enterprise_b', 'enterprise_c']),
  current_period_end: nullableStringSchema,
  cancel_at_period_end: z.boolean(),
  subscription_plans: z.array(subscriptionPlanSchema),
});

export const currentSessionSchema = z.object({
  user: z.object({
    id: idSchema,
    email: z.string().email(),
    display_name: nullableStringSchema,
    plan_code: z.string().min(1),
  }),
  personal_credits: creditBalanceSchema.nullable(),
  organizations: z.array(
    z.object({
      id: idSchema,
      name: z.string().min(1),
      status: organizationStatusSchema,
      plan_key: organizationPlanSchema,
      role: organizationRoleSchema,
      membership_status: organizationMembershipStatusSchema,
      monthly_credits: z.number().int().nonnegative(),
      purchased_credits: z.number().int().nonnegative(),
      total_credits: z.number().int().nonnegative(),
      monthly_expires_at: nullableStringSchema,
    }),
  ),
});

export const workSchema = z.object({
  id: idSchema,
  organization_id: nullableStringSchema,
  title: z.string(),
  genre: nullableStringSchema,
  world_setting: nullableStringSchema,
  theme: nullableStringSchema,
  main_entity_ids: z.array(idSchema),
  starting_point: nullableStringSchema,
  ending_point: nullableStringSchema,
  overall_flow: nullableStringSchema,
  version: z.number().int().nonnegative(),
  status: storyStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const worksResponseSchema = z.object({
  works: z.array(workSchema),
});

export const chapterSchema = z.object({
  id: idSchema,
  work_id: idSchema,
  order: z.number().int().positive(),
  title: nullableStringSchema,
  purpose: nullableStringSchema,
  starting_state: nullableStringSchema,
  ending_state: nullableStringSchema,
  emotion_curve: nullableStringSchema,
  entities_involved: z.array(idSchema),
  key_beats: z.array(z.string()),
  version: z.number().int().nonnegative(),
  status: storyStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const chaptersResponseSchema = z.object({
  chapters: z.array(chapterSchema),
});

export const episodeSchema = z.object({
  id: idSchema,
  chapter_id: idSchema,
  order: z.number().int().positive(),
  title: nullableStringSchema,
  purpose: nullableStringSchema,
  story_input_mode: z.enum(['structured', 'full']),
  story_full_draft: nullableStringSchema,
  introduction: nullableStringSchema,
  middle: nullableStringSchema,
  climax: nullableStringSchema,
  ending_hook: nullableStringSchema,
  estimated_pages: z.number().int().positive(),
  entities_involved: z.array(idSchema),
  page_skeleton_generated: z.boolean(),
  version: z.number().int().nonnegative(),
  status: storyStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const episodesResponseSchema = z.object({
  episodes: z.array(episodeSchema),
});

export const sceneSchema = z.object({
  id: idSchema,
  episode_id: idSchema,
  order: z.number().int().positive(),
  location: nullableStringSchema,
  time: nullableStringSchema,
  atmosphere: nullableStringSchema,
  involved_entity_ids: z.array(idSchema),
  entity_states: z.array(
    z.object({
      entity_id: idSchema,
      state_id: idSchema,
    }),
  ),
  status: z.enum(['draft', 'reviewing', 'ready']),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const scenesResponseSchema = z.object({
  scenes: z.array(sceneSchema),
});

export const entityStateSchema = z.object({
  id: idSchema,
  entity_id: idSchema,
  scene_id: nullableStringSchema,
  costume_note: nullableStringSchema,
  costume_ref_id: nullableStringSchema,
  condition_note: nullableStringSchema,
  hair_note: nullableStringSchema,
  expression_default: z.string().min(1).max(100),
  extra_note: nullableStringSchema,
  created_at: timestampSchema,
});

export const entityStatesResponseSchema = z.object({
  entity_states: z.array(entityStateSchema),
});

export const compositionSchema = z.object({
  id: idSchema,
  name: z.string(),
  category: z.string(),
  entity_count: z.number().int().nonnegative(),
  preview_cdn_url: nullableStringSchema,
  composition_prompt: z.string(),
  shot_type: nullableStringSchema,
  angle: nullableStringSchema,
  tags: z.array(z.string()),
  created_at: timestampSchema,
});

export const balloonSchema = z.object({
  id: idSchema,
  page_id: idSchema,
  speaker_entity_id: nullableStringSchema,
  balloon_type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper', 'sfx', 'caption']),
  writing_mode: z.enum(['horizontal', 'vertical']),
  text: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  tail: z.object({
    base_x: z.number(),
    base_y: z.number(),
    tip_x: z.number(),
    tip_y: z.number(),
  }).nullable(),
  font_size: z.number().int().positive(),
  font_family: z.enum(['manga_gothic', 'mincho', 'rounded', 'bold']),
  panel_order_reference: z.number().int().nullable(),
  z_index: z.number().int(),
});

export const balloonsResponseSchema = z.object({
  balloons: z.array(balloonSchema),
});

export const panelEntityAssignmentSchema = z.object({
  entity_id: idSchema,
  role: z.enum(['primary', 'secondary', 'background']),
  expression: z.enum(['determined', 'calm', 'angry', 'sad', 'surprised', 'custom']),
  custom_expression: nullableStringSchema,
  action: z.enum(['standing_firm', 'attacking', 'defending', 'running', 'custom']),
  custom_action: nullableStringSchema,
  position: z.enum(['left', 'center', 'right', 'background']),
  facing_direction: z
    .enum(['front', 'left', 'right', 'away', 'three_quarter_left', 'three_quarter_right'])
    .nullable(),
  effect_note: nullableStringSchema,
  state_id: nullableStringSchema,
});

export const panelAssignmentsResponseSchema = z.object({
  entities: z.array(panelEntityAssignmentSchema),
});

const panelDialogueSchema = z.object({
  entity_id: nullableStringSchema,
  text: z.string(),
  type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper', 'sfx']),
  position: z.enum(['top', 'bottom', 'left', 'right', 'center']),
});

export const panelSchema = z.object({
  id: idSchema,
  page_id: idSchema,
  order: z.number().int().positive(),
  panel_role: z.enum(['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact']),
  panel_size: z.enum(['standard', 'large', 'wide', 'narrow', 'splash']),
  situation_text: nullableStringSchema,
  entities: z.array(panelEntityAssignmentSchema),
  composition: z.object({
    source: z.enum(['gallery', 'custom', 'ai_auto']),
    gallery_item_id: nullableStringSchema,
    composition_prompt: nullableStringSchema,
    shot_type: nullableStringSchema,
    angle: nullableStringSchema,
    custom_note: nullableStringSchema,
  }),
  dialogue_in_panel: z.boolean(),
  dialogue: z.array(panelDialogueSchema),
  sfx_text: nullableStringSchema,
  background_note: nullableStringSchema,
  panel_notes: nullableStringSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const panelsResponseSchema = z.object({
  panels: z.array(panelSchema),
});

export const panelFrameSchema = z.object({
  id: idSchema,
  page_id: idSchema,
  panel_id: nullableStringSchema,
  vertices: z.array(z.object({ x: z.number(), y: z.number() })).min(3),
  border_style: z.enum(['solid', 'dashed', 'none']),
  border_width: z.number().nonnegative(),
  border_color: z.string(),
  z_index: z.number().int(),
  reading_order: z.number().int().nonnegative(),
});

export const framesResponseSchema = z.object({
  frames: z.array(panelFrameSchema),
});

export const frameTemplateResponseSchema = z.object({
  template_id: idSchema,
  panel_count: z.number().int().nonnegative(),
  frames: z.array(panelFrameSchema),
});

export const compositionsResponseSchema = z.object({
  compositions: z.array(compositionSchema),
});
