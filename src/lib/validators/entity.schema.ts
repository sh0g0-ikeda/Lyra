import { z } from 'zod';
import {
  ENTITY_IMPORT_MAX_FILE_SIZE_BYTES,
  ENTITY_REFERENCE_LIMITS,
} from '../../domain/constants/entityReference.js';
import type { EntityType } from '../../domain/types/entity.js';
import { ValidationError } from '../../domain/errors/index.js';
import { formatZodValidationError } from '../validationErrorFormatter.js';

export const entityTypeSchema = z.enum(['character', 'nonhuman', 'object']);

const jsonObjectSchema = z.record(z.string(), z.unknown());
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

const characterFreeTextField = (maxLength: number): z.ZodString => z.string().trim().max(maxLength);

const characterStructuredFieldsSchema = z
  .object({
    gender_expression: characterFreeTextField(100).optional(),
    age_range: characterFreeTextField(100).optional(),
    skin_tone: characterFreeTextField(100).optional(),
    first_impression: characterFreeTextField(150).optional(),
    standing_style: characterFreeTextField(150).optional(),
    default_expression: characterFreeTextField(150).optional(),
    face_shape: characterFreeTextField(100).optional(),
    eyebrow_shape: characterFreeTextField(100).optional(),
    nose_shape: characterFreeTextField(100).optional(),
    mouth_shape: characterFreeTextField(100).optional(),
    height: characterFreeTextField(100).optional(),
    build: characterFreeTextField(100).optional(),
    hair: z
      .object({
        color: characterFreeTextField(100).optional(),
        length: characterFreeTextField(100).optional(),
        style: characterFreeTextField(100).optional(),
        arrangement: characterFreeTextField(150).optional(),
        bangs: characterFreeTextField(100).optional(),
      })
      .optional(),
    eyes: z
      .object({
        color: characterFreeTextField(100).optional(),
        shape: characterFreeTextField(100).optional(),
        eyelid_type: characterFreeTextField(100).optional(),
      })
      .optional(),
    clothing: z
      .object({
        category: characterFreeTextField(150).optional(),
        main_color: characterFreeTextField(100).optional(),
        impression: characterFreeTextField(150).optional(),
        description: z.string().max(500).optional(),
      })
      .optional(),
    character_identity: z
      .object({
        aliases: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
        visual_anchor: z.string().max(300).optional(),
        signature_feature: z.string().max(300).optional(),
        silhouette_keywords: z.array(z.string().trim().min(1).max(100)).max(6).optional(),
      })
      .strict()
      .optional(),
    proportions: z
      .object({
        head_to_body_ratio: z.string().max(100).optional(),
        shoulder_width: z.string().max(100).optional(),
        leg_length: z.string().max(100).optional(),
        posture_axis: z.string().max(150).optional(),
      })
      .strict()
      .optional(),
    face_detail: z
      .object({
        eye_size: z.string().max(100).optional(),
        eye_angle: z.string().max(100).optional(),
        pupil_style: z.string().max(100).optional(),
        under_eye_detail: z.string().max(150).optional(),
        mouth_default: z.string().max(150).optional(),
      })
      .strict()
      .optional(),
    hair_detail: z
      .object({
        front_shape: z.string().max(150).optional(),
        side_hair: z.string().max(150).optional(),
        back_shape: z.string().max(150).optional(),
      })
      .strict()
      .optional(),
    outfit_detail: z
      .object({
        collar_shape: z.string().max(150).optional(),
        sleeve_length: z.string().max(100).optional(),
        skirt_or_pants_shape: z.string().max(150).optional(),
        shoes: z.string().max(150).optional(),
        socks_or_legwear: z.string().max(150).optional(),
      })
      .strict()
      .optional(),
    style_reference: styleReferenceSchema.optional(),
    distinguishing_features: z.string().max(500).optional(),
    art_style: characterFreeTextField(100).optional(),
  })
  .strict();

const nonhumanStructuredFieldsSchema = z
  .object({
    base_form: z.enum(['dragon', 'wolf', 'spirit', 'robot', 'zombie', 'deity', 'custom']).optional(),
    size: z.enum(['tiny', 'small', 'human_scale', 'large', 'enormous']).optional(),
    movement: z.enum(['bipedal', 'quadruped', 'flying', 'floating', 'slithering', 'custom']).optional(),
    distinctive_features: z.string().max(500).optional(),
    threat_level: z.enum(['harmless', 'low', 'medium', 'high', 'catastrophic']).optional(),
    art_style: z.enum(['anime', 'semi_realistic', 'manga', 'painterly']).optional(),
  })
  .strict();

const objectStructuredFieldsSchema = z
  .object({
    category: z
      .enum(['weapon', 'tool', 'vehicle', 'structure', 'consumable', 'magical', 'custom'])
      .optional(),
    material: z.enum(['metal', 'wood', 'stone', 'crystal', 'organic', 'energy', 'custom']).optional(),
    size: z.enum(['small', 'medium', 'large', 'enormous']).optional(),
    distinctive_features: z.string().max(500).optional(),
  })
  .strict();

export const uuidParamSchema = z.string().uuid();

export const createEntityBodySchema = z.object({
  entity_type: entityTypeSchema,
  name: z.string().trim().min(1).max(100),
  free_description: z.string().max(2000).nullable().optional(),
  prompt_supplement: z.string().max(ENTITY_REFERENCE_LIMITS.MAX_PROMPT_SUPPLEMENT_LENGTH).nullable().optional(),
  structured_fields: jsonObjectSchema.optional(),
  speech_profile: jsonObjectSchema.optional(),
}).strict();

export const updateEntityBodySchema = z
  .object({
    entity_type: entityTypeSchema.optional(),
    name: z.string().trim().min(1).max(100).optional(),
    free_description: z.string().max(2000).nullable().optional(),
    prompt_supplement: z
      .string()
      .max(ENTITY_REFERENCE_LIMITS.MAX_PROMPT_SUPPLEMENT_LENGTH)
      .nullable()
      .optional(),
    structured_fields: jsonObjectSchema.optional(),
    speech_profile: jsonObjectSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

export const importEntityImageBodySchema = z
  .object({
    image_base64: z.string().min(1).max(Math.ceil((ENTITY_IMPORT_MAX_FILE_SIZE_BYTES * 4) / 3) + 1024),
    entity_type: entityTypeSchema,
    entity_id: uuidParamSchema.optional(),
  })
  .strict();

export const generateEntityReferenceBodySchema = z
  .object({
    source_candidate_token: z.string().min(1).max(4096).optional(),
    source_s3_key: z.string().min(1).max(512).optional(),
  })
  .strict();

export const confirmEntityReferenceBodySchema = z
  .object({
    selected_s3_keys: z
      .array(z.string().min(1).max(512))
      .min(ENTITY_REFERENCE_LIMITS.MIN_CONFIRM_COUNT)
      .max(ENTITY_REFERENCE_LIMITS.MAX_CONFIRM_COUNT)
      .optional(),
    selected_candidate_tokens: z
      .array(z.string().min(1).max(4096))
      .min(ENTITY_REFERENCE_LIMITS.MIN_CONFIRM_COUNT)
      .max(ENTITY_REFERENCE_LIMITS.MAX_CONFIRM_COUNT)
      .optional(),
    primary_s3_key: z.string().min(1).max(512).optional(),
    primary_candidate_token: z.string().min(1).max(4096).optional(),
    prompt_supplement: z
      .string()
      .max(ENTITY_REFERENCE_LIMITS.MAX_PROMPT_SUPPLEMENT_LENGTH)
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.selected_s3_keys === undefined && body.selected_candidate_tokens === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selected_candidate_tokens is required',
        path: ['selected_candidate_tokens'],
      });
      return;
    }

    const selectedValues = body.selected_candidate_tokens ?? body.selected_s3_keys ?? [];
    const primaryValue = body.primary_candidate_token ?? body.primary_s3_key;
    const uniqueKeyCount = new Set(selectedValues).size;
    if (uniqueKeyCount !== selectedValues.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selected references must not contain duplicates',
        path: [body.selected_candidate_tokens === undefined ? 'selected_s3_keys' : 'selected_candidate_tokens'],
      });
    }

    if (primaryValue !== undefined && !selectedValues.includes(primaryValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'primary reference must be included in selected references',
        path: [body.primary_candidate_token === undefined ? 'primary_s3_key' : 'primary_candidate_token'],
      });
    }
  });

export const referenceIdParamSchema = z.string().trim().min(1).max(ENTITY_REFERENCE_LIMITS.MAX_REFERENCE_ID_LENGTH);

export function parseStructuredFields(
  entityType: EntityType,
  structuredFields: Record<string, unknown>,
): Record<string, unknown> {
  const schema = getStructuredFieldsSchema(entityType);
  const result = schema.safeParse(structuredFields);

  if (!result.success) {
    throw new ValidationError(formatZodValidationError(result.error));
  }

  return result.data;
}

function getStructuredFieldsSchema(entityType: EntityType): z.ZodType<Record<string, unknown>> {
  switch (entityType) {
    case 'character':
      return characterStructuredFieldsSchema;
    case 'nonhuman':
      return nonhumanStructuredFieldsSchema;
    case 'object':
      return objectStructuredFieldsSchema;
  }
}
