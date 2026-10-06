import { EPISODE_PAGE_PLAN_MAX_DIALOGUE_LINES_PER_PANEL } from '../../domain/constants/generation.js';
import { z } from 'zod';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import {
  autofillCompositionSchema,
  autofillDialogueLineSchema,
  autofillPanelEntityAssignmentSchema,
} from './pageAutofill.schema.js';

export const EPISODE_PLAN_AUDIT_COVERAGE_MAX_CHECKS_PER_PAGE = 2;
export const EPISODE_PLAN_AUDIT_COVERAGE_MAX_EVIDENCE_PER_CHECK = 2;
export const EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS = 40;
export const EPISODE_PLAN_AUDIT_COVERAGE_REF_MAX_CHARS = 24;

export const episodePlanAuditIssueCodes = [
  'duplicate_dialogue',
  'dialogue_density',
  'duplicate_visual_beat',
  'timeline_discontinuity',
  'dialogue_misplacement',
  'knowledge_violation',
  'page_handoff_break',
  'unsupported_story_fact',
  'source_omission',
  'ongoing_action_dropped',
  'visible_entity_mismatch',
] as const;

export const episodePlanAuditPageRepairFields = [
  'source_scene_ids',
  'page_purpose',
  'continuity_note',
  'dialogue_mode',
  'page_dialogue_toggle',
] as const;

export const episodePlanAuditPanelRepairFields = [
  'panel_role',
  'panel_size',
  'situation_text',
  'composition',
  'dialogue_in_panel',
  'dialogue',
  'sfx_text',
  'background_note',
  'panel_notes',
  'entities',
] as const;

type EpisodePlanAuditPageRepairField = (typeof episodePlanAuditPageRepairFields)[number];
type EpisodePlanAuditPanelRepairField = (typeof episodePlanAuditPanelRepairFields)[number];

const nonNullablePageRepairFields: ReadonlySet<EpisodePlanAuditPageRepairField> = new Set([
  'source_scene_ids',
  'dialogue_mode',
  'page_dialogue_toggle',
]);

const nonNullablePanelRepairFields: ReadonlySet<EpisodePlanAuditPanelRepairField> = new Set([
  'panel_role',
  'panel_size',
  'composition',
  'dialogue_in_panel',
  'dialogue',
  'entities',
]);

const episodePlanAuditIssueSchema = z
  .object({
    code: z.enum(episodePlanAuditIssueCodes),
    severity: z.enum(['warning', 'error']),
    page_ids: z.array(z.string().uuid()).min(1).max(STORY_AI_LIMITS.maxSkeletonPages),
    message: z.string().trim().min(1).max(1_000),
    repair_instruction: z.string().trim().min(1).max(1_000),
  })
  .strict();

const pageRepairPatchSchema = z
  .object({
    source_scene_ids: z.array(z.string().uuid()).max(100).nullable(),
    page_purpose: z.string().trim().min(1).max(500).nullable(),
    continuity_note: z.string().trim().min(1).max(1_000).nullable(),
    dialogue_mode: z.enum(['image_baked', 'balloon_only', 'mixed']).nullable(),
    page_dialogue_toggle: z.boolean().nullable(),
  })
  .strict();

const panelRepairPatchSchema = z
  .object({
    panel_role: z
      .enum(['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact'])
      .nullable(),
    panel_size: z.enum(['standard', 'large', 'wide', 'narrow', 'splash']).nullable(),
    situation_text: z.string().trim().min(1).max(2_000).nullable(),
    composition: autofillCompositionSchema.nullable(),
    dialogue_in_panel: z.boolean().nullable(),
    dialogue: z.array(autofillDialogueLineSchema).max(EPISODE_PAGE_PLAN_MAX_DIALOGUE_LINES_PER_PANEL).nullable(),
    sfx_text: z.string().trim().min(1).max(200).nullable(),
    background_note: z.string().trim().min(1).max(2_000).nullable(),
    panel_notes: z.string().trim().min(1).max(2_000).nullable(),
    entities: z.array(autofillPanelEntityAssignmentSchema).max(20).nullable(),
  })
  .strict();

const episodePlanAuditPageRepairSchema = z
  .object({
    page_id: z.string().uuid(),
    changed_fields: z
      .array(z.enum(episodePlanAuditPageRepairFields))
      .min(1)
      .max(episodePlanAuditPageRepairFields.length)
      .refine((fields) => new Set(fields).size === fields.length, 'changed_fields must be unique'),
    patch: pageRepairPatchSchema,
  })
  .strict()
  .superRefine((repair, context) => {
    for (const field of repair.changed_fields) {
      if (nonNullablePageRepairFields.has(field) && repair.patch[field] === null) {
        context.addIssue({
          code: 'custom',
          path: ['patch', field],
          message: `${field} must not be null when included in changed_fields`,
        });
      }
    }
  });

const episodePlanAuditPanelRepairSchema = z
  .object({
    page_id: z.string().uuid(),
    panel_order: z.number().int().min(1).max(1_000),
    changed_fields: z
      .array(z.enum(episodePlanAuditPanelRepairFields))
      .min(1)
      .max(episodePlanAuditPanelRepairFields.length)
      .refine((fields) => new Set(fields).size === fields.length, 'changed_fields must be unique'),
    patch: panelRepairPatchSchema,
  })
  .strict()
  .superRefine((repair, context) => {
    for (const field of repair.changed_fields) {
      if (nonNullablePanelRepairFields.has(field) && repair.patch[field] === null) {
        context.addIssue({
          code: 'custom',
          path: ['patch', field],
          message: `${field} must not be null when included in changed_fields`,
        });
      }
    }
  });

const episodePlanAuditCoverageEvidenceSchema = z
  .object({
    output_ref: z.string().trim().min(1).max(EPISODE_PLAN_AUDIT_COVERAGE_REF_MAX_CHARS),
    quote: z.string().trim().min(4).max(EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS),
  })
  .strict();

const episodePlanAuditCoverageRepairTargetSchema = z
  .object({
    scope: z.literal('panel'),
    page_id: z.string().uuid(),
    panel_order: z.number().int().min(1).max(1_000),
  })
  .strict();

const episodePlanAuditCoverageCheckSchema = z
  .object({
    source_ref: z.string().trim().min(1).max(EPISODE_PLAN_AUDIT_COVERAGE_REF_MAX_CHARS),
    source_quote: z.string().trim().min(4).max(EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS),
    status: z.enum(['present', 'missing']),
    output_evidence: z
      .array(episodePlanAuditCoverageEvidenceSchema)
      .max(EPISODE_PLAN_AUDIT_COVERAGE_MAX_EVIDENCE_PER_CHECK),
    issue_code: z.enum(['source_omission', 'ongoing_action_dropped']).nullable(),
    repair_target: episodePlanAuditCoverageRepairTargetSchema.nullable(),
  })
  .strict()
  .superRefine((check, context) => {
    const presentShapeIsValid = check.status === 'present'
      && check.output_evidence.length > 0
      && check.issue_code === null
      && check.repair_target === null;
    const missingShapeIsValid = check.status === 'missing'
      && check.output_evidence.length === 0
      && check.issue_code !== null
      && check.repair_target !== null;
    if (!presentShapeIsValid && !missingShapeIsValid) {
      context.addIssue({
        code: 'custom',
        message: 'coverage status must match evidence, issue, and repair target',
      });
    }
  });

const episodePlanAuditSourceCoverageSchema = z
  .object({
    page_id: z.string().uuid(),
    checks: z
      .array(episodePlanAuditCoverageCheckSchema)
      .min(1)
      .max(EPISODE_PLAN_AUDIT_COVERAGE_MAX_CHECKS_PER_PAGE),
  })
  .strict();

export const episodePlanAuditSchema = z
  .object({
    accepted: z.boolean(),
    issues: z.array(episodePlanAuditIssueSchema).max(STORY_AI_LIMITS.maxSkeletonPages * 4),
    page_repairs: z.array(episodePlanAuditPageRepairSchema).max(STORY_AI_LIMITS.maxSkeletonPages),
    panel_repairs: z
      .array(episodePlanAuditPanelRepairSchema)
      .max(STORY_AI_LIMITS.maxSkeletonPages * STORY_AI_LIMITS.maxPanelsPerPage),
    source_coverage: z
      .array(episodePlanAuditSourceCoverageSchema)
      .min(1)
      .max(STORY_AI_LIMITS.maxSkeletonPages),
  })
  .strict();

export type EpisodePlanAuditPayload = z.infer<typeof episodePlanAuditSchema>;
