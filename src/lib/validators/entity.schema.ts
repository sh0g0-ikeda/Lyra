import { z } from 'zod';
import {
  ENTITY_IMPORT_MAX_FILE_SIZE_BYTES,
  ENTITY_REFERENCE_LIMITS,
} from '../../domain/constants/entityReference.js';
import type { EntityType } from '../../domain/types/entity.js';
import { ValidationError } from '../../domain/errors/index.js';

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

const characterStructuredFieldsSchema = z
  .object({
    gender_expression: z.enum(['female', 'male', 'androgynous', 'unspecified']).optional(),
    age_range: z
      .enum(['child', 'early_teens', 'late_teens', 'twenties', 'thirties', 'forties_plus', 'ageless'])
      .optional(),
    skin_tone: z.enum(['fair', 'light', 'medium', 'tan', 'deep', 'custom']).optional(),
    first_impression: z
      .enum([
        'bright_friendly',
        'quiet_neat',
        'cool_distant',
        'gentle_soft',
        'serious_reliable',
        'mysterious_fragile',
        'energetic_bold',
      ])
      .optional(),
    standing_style: z
      .enum(['upright_neat', 'natural_relaxed', 'shy_reserved', 'confident_open', 'still_quiet'])
      .optional(),
    default_expression: z
      .enum(['soft_smile', 'calm_neutral', 'serious_focus', 'cheerful_smile', 'shy_reserved', 'cool_unfazed'])
      .optional(),
    face_shape: z
      .enum(['round', 'oval', 'heart', 'square', 'diamond', 'long', 'soft_triangle', 'custom'])
      .optional(),
    eyebrow_shape: z
      .enum(['straight', 'soft_arch', 'high_arch', 'thick', 'thin', 'sharp', 'custom'])
      .optional(),
    nose_shape: z
      .enum(['small', 'straight', 'button', 'sharp', 'rounded', 'broad', 'custom'])
      .optional(),
    mouth_shape: z
      .enum(['soft', 'full', 'thin', 'wide', 'smirk', 'serious', 'custom'])
      .optional(),
    height: z.enum(['short', 'average', 'tall']).optional(),
    build: z.enum(['petite', 'slender', 'average', 'athletic', 'muscular', 'curvy']).optional(),
    hair: z
      .object({
        color: z
          .enum(['black', 'brown', 'blonde', 'silver', 'white', 'blue', 'red', 'pink', 'purple', 'custom'])
          .optional(),
        length: z.enum(['very_short', 'short', 'medium', 'long', 'very_long']).optional(),
        style: z.enum(['straight', 'wavy', 'curly', 'wild']).optional(),
        arrangement: z
          .enum([
            'down',
            'short_cut',
            'buzz_cut',
            'crew_cut',
            'undercut',
            'short_bob',
            'center_part',
            'side_part',
            'slick_back',
            'long_straight',
            'medium_layered',
            'wolf_cut',
            'short_perm',
            'ponytail',
            'side_ponytail',
            'twin_tails',
            'bun',
            'braid',
            'half_up',
            'hime_cut',
            'custom',
          ])
          .optional(),
        bangs: z
          .enum(['none', 'light', 'standard', 'heavy', 'side_swept', 'blunt'])
          .optional(),
      })
      .optional(),
    eyes: z
      .object({
        color: z
          .enum(['black', 'brown', 'blue', 'green', 'red', 'gold', 'silver', 'purple', 'custom'])
          .optional(),
        shape: z.enum(['gentle', 'sharp', 'round', 'narrow']).optional(),
        eyelid_type: z.enum(['single', 'double']).optional(),
      })
      .optional(),
    clothing: z
      .object({
        category: z
          .enum([
            'military',
            'school',
            'casual',
            'suit',
            'fantasy',
            'japanese',
            'streetwear',
            'hoodie',
            'sports',
            'winter_coat',
            'workwear',
            'armor',
            'gothic',
            'formal_dress',
            'idol_stage',
            'custom',
          ])
          .optional(),
        main_color: z
          .enum(['black', 'white', 'navy', 'gray', 'brown', 'red', 'blue', 'green', 'custom'])
          .optional(),
        impression: z.enum(['formal', 'practical', 'elegant', 'rough', 'cute', 'custom']).optional(),
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
    art_style: z.enum(['anime', 'semi_realistic', 'manga', 'painterly']).optional(),
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
  })
  .strict();

export const generateEntityReferenceBodySchema = z
  .object({
    source_s3_key: z.string().min(1).max(512).optional(),
  })
  .strict();

export const confirmEntityReferenceBodySchema = z
  .object({
    selected_s3_keys: z
      .array(z.string().min(1).max(512))
      .min(ENTITY_REFERENCE_LIMITS.MIN_CONFIRM_COUNT)
      .max(ENTITY_REFERENCE_LIMITS.MAX_CONFIRM_COUNT),
    primary_s3_key: z.string().min(1).max(512).optional(),
    prompt_supplement: z
      .string()
      .max(ENTITY_REFERENCE_LIMITS.MAX_PROMPT_SUPPLEMENT_LENGTH)
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const uniqueKeyCount = new Set(body.selected_s3_keys).size;
    if (uniqueKeyCount !== body.selected_s3_keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selected_s3_keys must not contain duplicates',
        path: ['selected_s3_keys'],
      });
    }

    if (
      body.primary_s3_key !== undefined &&
      !body.selected_s3_keys.includes(body.primary_s3_key)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'primary_s3_key must be included in selected_s3_keys',
        path: ['primary_s3_key'],
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
    throw new ValidationError(result.error.message);
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
