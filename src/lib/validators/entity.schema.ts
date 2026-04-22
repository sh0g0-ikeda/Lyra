import { z } from 'zod';
import type { EntityType } from '../../domain/types/entity.js';
import { ValidationError } from '../../domain/errors/index.js';

export const entityTypeSchema = z.enum(['character', 'nonhuman', 'object']);

const jsonObjectSchema = z.record(z.string(), z.unknown());

const characterStructuredFieldsSchema = z
  .object({
    gender_expression: z.enum(['female', 'male', 'androgynous', 'unspecified']).optional(),
    age_range: z
      .enum(['child', 'early_teens', 'late_teens', 'twenties', 'thirties', 'forties_plus', 'ageless'])
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
          .enum(['down', 'ponytail', 'twin_tails', 'bun', 'braid', 'half_up', 'custom'])
          .optional(),
      })
      .optional(),
    eyes: z
      .object({
        color: z
          .enum(['black', 'brown', 'blue', 'green', 'red', 'gold', 'silver', 'purple', 'custom'])
          .optional(),
        shape: z.enum(['gentle', 'sharp', 'round', 'narrow']).optional(),
      })
      .optional(),
    clothing: z
      .object({
        category: z
          .enum(['military', 'school', 'casual', 'suit', 'fantasy', 'japanese', 'custom'])
          .optional(),
        main_color: z
          .enum(['black', 'white', 'navy', 'gray', 'brown', 'red', 'blue', 'green', 'custom'])
          .optional(),
        impression: z.enum(['formal', 'practical', 'elegant', 'rough', 'cute', 'custom']).optional(),
      })
      .optional(),
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
  structured_fields: jsonObjectSchema.optional(),
  speech_profile: jsonObjectSchema.optional(),
});

export const updateEntityBodySchema = z
  .object({
    entity_type: entityTypeSchema.optional(),
    name: z.string().trim().min(1).max(100).optional(),
    free_description: z.string().max(2000).nullable().optional(),
    structured_fields: jsonObjectSchema.optional(),
    speech_profile: jsonObjectSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

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
