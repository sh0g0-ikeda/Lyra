import { z } from 'zod';
import { PANEL_FRAME_TEMPLATE_IDS } from '../../domain/constants/panelFrameTemplates.js';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import { APP_LANGUAGES } from '../../domain/types/language.js';

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
    language: z.enum(APP_LANGUAGES).optional().default('ja'),
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

export const generatePageSkeletonBodySchema = z
  .object({
    overwrite_existing: z.boolean().optional().default(false),
    apply_story_plan: z.boolean().optional().default(true),
    language: z.enum(APP_LANGUAGES).optional().default('ja'),
  })
  .strict();

const episodeStoryInputModeSchema = z.enum(['structured', 'full']);

const episodeDraftFieldsSchema = z
  .object({
    title: nullableText(200).optional().default(null),
    purpose: nullableText(2000).optional().default(null),
    story_input_mode: episodeStoryInputModeSchema.optional().default('structured'),
    story_full_draft: nullableText(8000).optional().default(null),
    introduction: nullableText(2000).optional().default(null),
    middle: nullableText(2000).optional().default(null),
    climax: nullableText(2000).optional().default(null),
    ending_hook: nullableText(2000).optional().default(null),
  })
  .strict();

export const improveEpisodeDraftBodySchema = z
  .object({
    episode_id: z.string().uuid(),
    instruction: z.string().trim().min(1).max(STORY_AI_LIMITS.instructionMaxLength),
    language: z.enum(APP_LANGUAGES).optional().default('ja'),
    base_draft: episodeDraftFieldsSchema,
  })
  .strict();

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

export const improveEpisodeDraftResponseSchema = z
  .object({
    introduction: nullableText(2000),
    middle: nullableText(2000),
    climax: nullableText(2000),
    ending_hook: nullableText(2000),
  })
  .strict();

const boundedPlannerText = z.string().trim().min(1).max(600);
const boundedPlannerList = z.array(boundedPlannerText).max(10);

const episodeImprovementSectionPlanSchema = z
  .object({
    objective: boundedPlannerText.nullable(),
    must_include: boundedPlannerList,
    visual_beats: boundedPlannerList,
    narration_hints: boundedPlannerList,
    continuity_guards: boundedPlannerList,
    avoid: boundedPlannerList,
  })
  .strict();

export const episodeImprovementPlanResponseSchema = z
  .object({
    story_objective: boundedPlannerText.nullable(),
    must_preserve: boundedPlannerList,
    continuity_guards: boundedPlannerList,
    page_adaptation_notes: boundedPlannerList,
    introduction: episodeImprovementSectionPlanSchema,
    middle: episodeImprovementSectionPlanSchema,
    climax: episodeImprovementSectionPlanSchema,
    ending_hook: episodeImprovementSectionPlanSchema,
  })
  .strict();

const auditNoteListSchema = z.array(z.string().trim().min(1).max(400)).max(8);

export const episodeImprovementAuditResponseSchema = z
  .object({
    verdict: z.enum(['pass', 'revise']),
    global_issues: auditNoteListSchema,
    introduction: auditNoteListSchema,
    middle: auditNoteListSchema,
    climax: auditNoteListSchema,
    ending_hook: auditNoteListSchema,
  })
  .strict();
